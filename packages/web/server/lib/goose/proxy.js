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

const buildUpstreamHeaders = (incoming, secret) => {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === 'host') continue;
    // Never let a webview-supplied secret ride through — ours is authoritative.
    if (lower === 'x-secret-key') continue;
    if (typeof value === 'string' || Array.isArray(value)) {
      headers[name] = value;
    }
  }
  if (secret) {
    headers['x-secret-key'] = secret;
  }
  return headers;
};

export const registerGooseProxyRoutes = (app, { logger = console } = {}) => {
  const port = Number.parseInt(process.env.EPISTEMOS_GOOSE_PORT || '', 10);
  const secret = process.env.EPISTEMOS_GOOSE_SECRET || '';
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return false;
  }

  app.use('/goose', (req, res) => {
    const upstreamPath = req.originalUrl.startsWith('/goose')
      ? req.originalUrl.slice('/goose'.length) || '/'
      : req.originalUrl;

    const upstream = http.request(
      {
        host: '127.0.0.1',
        port,
        path: upstreamPath,
        method: req.method,
        headers: buildUpstreamHeaders(req.headers, secret),
      },
      (upstreamRes) => {
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

    upstream.on('error', (error) => {
      logger.error?.('[goose-proxy] upstream error:', error?.message ?? error);
      if (!res.headersSent) {
        res.status(502).json({ error: 'goose upstream unavailable' });
      } else {
        res.end();
      }
    });

    res.on('close', () => {
      upstream.destroy();
    });

    req.pipe(upstream);
  });

  logger.info?.(`[goose-proxy] /goose/* -> 127.0.0.1:${port} (secret ${secret ? 'attached' : 'ABSENT'})`);
  return true;
};
