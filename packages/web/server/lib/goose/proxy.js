// EPISTEMOS overlay (Plan 1-PRO §3): same-origin /goose/* proxy to the
// supervised goosed child. The UI never sees goosed directly and NEVER holds
// the secret — X-Secret-Key is attached here, server-side, from env injected
// by the Swift supervisor. Inert (returns false, no routes) when no goose
// port is configured, so stock and engine-less runs are byte-identical.
//
// Transport notes:
// - node:http (not fetch/undici): streams request AND response bodies natively
//   (goosed's /reply is SSE), and is immune to the WHATWG fetch bad-port list
//   that broke the opencode SSE hop during P0 smoke (port 4190 = "sieve").
// - goosed's REST surface is the v1 transport; the ACP migration replaces this
//   module without touching the client seam (adapter-owned contract).

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// Hardening: the proxy is a SECRET-INJECTING boundary — anything reaching
// /goose/* gets authenticated to goosed. So forward only the headers the
// goose REST/SSE surface actually needs (the adapter sets Accept +
// Content-Type; SSE resume uses Last-Event-ID). An allowlist — not a
// denylist — keeps the UI's cookies / Authorization / ui-auth tokens from
// leaking downstream to goosed, and shrinks the request-smuggling surface.
const FORWARDED_REQUEST_HEADERS = new Set([
  'content-type',
  'content-length',
  'accept',
  'accept-language',
  'cache-control',
  'last-event-id',
  'user-agent',
]);

export const buildUpstreamHeaders = (incoming, secret) => {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    if (!FORWARDED_REQUEST_HEADERS.has(lower)) continue;
    if (typeof value === 'string' || Array.isArray(value)) {
      headers[name] = value;
    }
  }
  // Our per-launch secret is authoritative; a client-supplied X-Secret-Key
  // can never reach here (not in the allowlist).
  if (secret) {
    headers['x-secret-key'] = secret;
  }
  return headers;
};

// Loopback-origin defense-in-depth (the surface binds 127.0.0.1 only). Allow
// a request with NO Origin (same-origin GET) or a loopback Origin; reject a
// request that carries a cross-origin (non-loopback) Origin — that can only be
// a hostile browsing context trying to drive goose with the injected secret.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export const isLoopbackOriginAllowed = (req) => {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
};

const GOOSE_INDEX_MAX_BYTES = 1024 * 1024;

const gooseIndexFile = () =>
  path.join(os.homedir(), '.epistemos', 'goose-session-index.json');

/**
 * Adapter-index persistence: the SPA runs in a NON-PERSISTENT webview data
 * store, so its localStorage index dies with the app. The server keeps the
 * durable copy; the client hydrates on boot and pushes on change. The same
 * endpoint feeds the native all-chats sheet.
 */
const registerGooseIndexRoutes = (app, logger) => {
  app.get('/goose-index', (_req, res) => {
    try {
      const raw = fs.readFileSync(gooseIndexFile(), 'utf8');
      const parsed = JSON.parse(raw);
      res.json(Array.isArray(parsed) ? parsed : []);
    } catch {
      res.json([]);
    }
  });

  app.put('/goose-index', express.json({ limit: GOOSE_INDEX_MAX_BYTES }), (req, res) => {
    // State-changing route — refuse a cross-origin request even if it reaches
    // the loopback port from a hostile browsing context.
    if (!isLoopbackOriginAllowed(req)) {
      res.status(403).json({ error: 'cross-origin goose index write refused' });
      return;
    }
    try {
      const parsed = req.body;
      if (!Array.isArray(parsed)) {
        res.status(400).json({ error: 'goose index must be an array' });
        return;
      }
      // Bound the entry count too (the byte limit alone allows a huge array of
      // tiny objects); the index is a session list, not a data store.
      if (parsed.length > 10_000) {
        res.status(413).json({ error: 'goose index too large' });
        return;
      }
      const file = gooseIndexFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Unique temp name (pid alone is not unique across rapid writes within
      // one process) + atomic rename so a concurrent read never sees a partial
      // file. O_EXCL-style: write with restrictive perms.
      const tmp = `${file}.tmp-${process.pid}-${req.socket?.remotePort ?? '0'}`;
      fs.writeFileSync(tmp, JSON.stringify(parsed), { mode: 0o600 });
      fs.renameSync(tmp, file);
      res.json({ ok: true, entries: parsed.length });
    } catch (error) {
      logger.error?.('[goose-index] write failed:', error?.message ?? error);
      res.status(500).json({ error: 'goose index write failed' });
    }
  });
};

export const registerGooseProxyRoutes = (app, { logger = console } = {}) => {
  const port = Number.parseInt(process.env.EPISTEMOS_GOOSE_PORT || '', 10);
  const secret = process.env.EPISTEMOS_GOOSE_SECRET || '';
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return false;
  }

  registerGooseIndexRoutes(app, logger);

  // Idle timeout for the upstream leg. goosed pings SSE every 500ms, so a live
  // stream keeps the socket active and never trips this; it only fires when
  // goosed accepts the connection then goes silent (hung), so one bad request
  // can't pin a proxy connection forever.
  const UPSTREAM_IDLE_TIMEOUT_MS = 120_000;

  app.use('/goose', (req, res) => {
    // Defense-in-depth: a cross-origin browsing context must not drive goose
    // with the injected secret (the surface is loopback-only regardless).
    if (!isLoopbackOriginAllowed(req)) {
      res.status(403).json({ error: 'cross-origin goose request refused' });
      return;
    }

    const upstreamPath = req.originalUrl.startsWith('/goose')
      ? req.originalUrl.slice('/goose'.length) || '/'
      : req.originalUrl;

    // Donor middleware upstream of this mount may have PARSED (and thus fully
    // consumed) the request stream, in which case req.pipe() delivers nothing
    // and goosed waits forever for a body whose Content-Length was announced
    // (hit live: POST /goose/agent/start hung while the direct call answered).
    // The donor's custom parser sets req.body but NOT req._body, so a defined
    // req.body is the reliable "already consumed" signal. Method-aware:
    //  - bodyless methods (GET/HEAD) never forward a body (a parser leaving
    //    req.body={} must not become a spurious "{}" payload);
    //  - body methods re-serialize the consumed body (object→JSON, incl. {});
    //  - an UNPARSED body request (req.body undefined) streams through intact.
    const methodHasBody = !['GET', 'HEAD'].includes((req.method || 'GET').toUpperCase());
    let bodyBuffer = null;
    if (methodHasBody && req.body !== undefined && req.body !== null) {
      const parsed = req.body;
      if (Buffer.isBuffer(parsed)) {
        bodyBuffer = parsed;
      } else if (typeof parsed === 'string') {
        bodyBuffer = Buffer.from(parsed);
      } else if (typeof parsed === 'object') {
        bodyBuffer = Buffer.from(JSON.stringify(parsed));
      }
    }

    const upstreamHeaders = buildUpstreamHeaders(req.headers, secret);
    if (bodyBuffer) {
      upstreamHeaders['content-length'] = String(bodyBuffer.length);
    }

    let settled = false;
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port,
        path: upstreamPath,
        method: req.method,
        headers: upstreamHeaders,
      },
      (upstreamRes) => {
        settled = true;
        res.status(upstreamRes.statusCode || 502);
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
          if (value !== undefined) {
            res.setHeader(name, value);
          }
        }
        const contentType = String(upstreamRes.headers['content-type'] || '');
        if (contentType.toLowerCase().includes('text/event-stream')) {
          // goosed pings every 500ms; don't let Nagle batch the stream.
          if (res.socket && typeof res.socket.setNoDelay === 'function') {
            res.socket.setNoDelay(true);
          }
          if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
          }
        }
        upstreamRes.pipe(res);
      },
    );

    upstream.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => {
      logger.error?.('[goose-proxy] upstream idle timeout');
      upstream.destroy(new Error('upstream idle timeout'));
    });

    upstream.on('error', (error) => {
      logger.error?.('[goose-proxy] upstream error:', error?.message ?? error);
      if (!res.headersSent) {
        res.status(settled ? 502 : 504).json({ error: 'goose upstream unavailable' });
      } else {
        res.end();
      }
    });

    // Tear down BOTH legs when either side closes, so an aborted client request
    // can't leak an upstream socket and vice-versa.
    res.on('close', () => {
      upstream.destroy();
    });
    req.on('aborted', () => {
      upstream.destroy();
    });

    if (bodyBuffer) {
      upstream.end(bodyBuffer);
    } else {
      req.pipe(upstream);
      // A client that stops sending mid-body shouldn't hang the upstream.
      req.on('error', () => upstream.destroy());
    }
  });

  logger.info?.(`[goose-proxy] /goose/* -> 127.0.0.1:${port} (secret ${secret ? 'attached' : 'ABSENT'})`);
  return true;
};
