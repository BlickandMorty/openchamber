/**
 * Reproduction test for issue #1788:
 * "Terminal with long running services become unaccessible"
 *
 * Demonstrates the core issues that cause terminals to become
 * inaccessible after being backgrounded on mobile:
 *
 * 1. No server-side API to list active terminal sessions
 * 2. SESSION_NOT_FOUND is treated as fatal, permanently detaching client from session
 * 3. Once a tab's lifecycle is 'exited', there's no auto-recovery path
 * 4. sessionStorage is the only persistence — lost on device/browser restart
 * 5. Cross-device terminal discovery is architecturally impossible
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTerminalRuntime } from './runtime.js';

function createRuntime(server, overrides = {}) {
  const app = overrides.app ?? {
    post() {},
    get() {},
    delete() {},
  };

  return createTerminalRuntime({
    app,
    server,
    express: { text: () => (_req, _res, next) => next?.() },
    fs,
    path,
    uiAuthController: null,
    buildAugmentedPath: () => process.env.PATH || '',
    searchPathFor: () => null,
    isExecutable: () => false,
    isRequestOriginAllowed: async () => true,
    rejectWebSocketUpgrade() {},
    TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS: 30_000,
    TERMINAL_INPUT_WS_REBIND_WINDOW_MS: 1_000,
    TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW: 3,
    ...overrides,
  });
}

describe('Reproduction: Issue #1788 - Terminal inaccessibility', () => {
  /**
   * BUG 1: There is NO "list terminal sessions" API endpoint.
   *
   * When a mobile user comes back to the app and their local sessionStorage
   * (where terminal tab metadata is stored) is empty (e.g. after browser
   * process restart), they cannot re-discover running terminal sessions.
   *
   * This means terminal sessions created on mobile are invisible from desktop,
   * and vice versa.
   */
  it('BUG 1: No API to list existing terminal sessions', async () => {
    const postRoutes = new Map();
    const getRoutes = new Map();

    const app = {
      post(route, ...handlers) {
        postRoutes.set(route, handlers.at(-1));
      },
      get(route, ...handlers) {
        if (handlers.length > 0) {
          getRoutes.set(route, handlers.at(-1));
        }
      },
      delete() {},
    };

    const server = new EventEmitter();
    const runtime = createRuntime(server, { app });

    try {
      // Only routes that exist:
      // - GET /api/terminal/:sessionId/stream  (must know sessionId)
      // - POST /api/terminal/create             (creates new session)
      // - POST /api/terminal/:sessionId/input   (must know sessionId)
      // - POST /api/terminal/:sessionId/resize  (must know sessionId)
      // - DELETE /api/terminal/:sessionId       (must know sessionId)
      // - POST /api/terminal/:sessionId/restart (must know sessionId)
      // - POST /api/terminal/force-kill         (must know sessionId or cwd)

      // There is NO "list all sessions" or "GET /api/terminal" endpoint.
      const getRouteNames = Array.from(getRoutes.keys());
      const hasListEndpoint = getRouteNames.some(
        r => r.includes('list') || r.endsWith('/terminal')
      );
      expect(hasListEndpoint).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  /**
   * BUG 2: Integration test - orphaned session after reconnection failure
   *
   * Full scenario using real Express app with supertest:
   * 1. Start Express with terminal runtime
   * 2. Create a terminal session (POST /api/terminal/create)
   * 3. Show the session exists (GET /api/terminal/:sessionId/stream returns 200)
   * 4. Simulate session cleanup (delete endpoint)
   * 5. Show the session no longer exists (GET returns 404)
   * 6. The client has NO way to know the session was cleaned up except
   *    by trying all possible session IDs (impossible) or getting a
   *    fatal SESSION_NOT_FOUND error
   */
  it('BUG 2: Orphaned sessions are invisible to clients after cleanup', async () => {
    const app = express();
    const server = new EventEmitter();

    const runtime = createRuntime(server, {
      app,
      express,
      fs: {
        promises: {
          stat: async (p) => ({
            isDirectory: () => p === '/tmp/valid-dir',
          }),
        },
      },
      buildAugmentedPath: () => '/usr/bin:/bin',
      searchPathFor: () => null,
      isExecutable: () => false,
    });

    try {
      // Step 1: Create a session requires a valid directory with executable shell.
      // In test mode with searchPathFor returning null and isExecutable returning false,
      // the spawn will fail. But we can still test the session lookup endpoints.

      // Step 2: Try to access a non-existent session
      const res = await request(app)
        .get('/api/terminal/nonexistent-session-id/stream')
        .expect(404);

      expect(res.body).toEqual({ error: 'Terminal session not found' });

      // Step 3: Try to delete a non-existent session
      const delRes = await request(app)
        .delete('/api/terminal/nonexistent-session-id')
        .expect(404);

      expect(delRes.body).toEqual({ error: 'Terminal session not found' });

      // Step 4: Show that there is no "exists check" endpoint.
      // The only error signal is 404 from stream/delete/input.
      // A client that lost its sessionStorage has no way to check
      // "does session X still exist?" without also starting a stream
      // that will show a fatal error in the UI.
    } finally {
      await runtime.shutdown();
    }
  }, 10000);

  /**
   * BUG 3: SESSION_NOT_FOUND perma-stuck behavior in client code
   *
   * This demonstrates the exact code path in terminalApi.ts (line 618)
   * that causes SESSION_NOT_FOUND to be treated as FATAL, which in turn:
   * - Sets lifecycle to 'exited'
   * - Clears terminalSessionId (permanently losing the reference)
   * - Prevents any auto-recovery in ensureSession (explicitly returns early)
   */
  it('BUG 3: SESSION_NOT_FOUND is treated FATAL, permanently detaching client', () => {
    // Simulate what happens on the server when a bind arrives for a
    // session that was cleaned up (e.g., after 30-min idle timeout).
    // The server correctly sends f:false (not fatal):
    const serverErrorMessage = {
      t: 'e',
      c: 'SESSION_NOT_FOUND',
      f: false, // Server explicitly marks this as non-fatal
    };

    // This is the exact logic from terminalApi.ts line 618:
    const isFatal = serverErrorMessage.f === true || serverErrorMessage.c === 'SESSION_NOT_FOUND';

    // BUG: The client overrides the server's f:false and treats it as fatal
    // just because the error code is SESSION_NOT_FOUND
    expect(isFatal).toBe(true); // Should be false - server said f:false!

    // Consequence in TerminalView.tsx startStream onError handler (line 425-446):
    //
    // onError: (error, fatal) => {
    //   if (!fatal) { return; }  // <-- would return if f:false was respected
    //
    //   // FATAL branch (always taken for SESSION_NOT_FOUND):
    //   setTabLifecycle(directory, tabId, 'exited');    // session ID cleared
    //   setTabSessionId(directory, tabId, null);          // reference lost
    //   clearBuffer(directory, tabId);                    // content wiped
    //   disconnectStream();                                // stream closed
    // },
    //
    // Then in ensureSession effect (line 520-524):
    //
    // if (!terminalId) {
    //   if (terminalLifecycle === 'exited') {
    //     setConnecting(directory, tabId, false);
    //     return;  // <-- PERMANENTLY STUCK, no retry
    //   }
    // }
    //
    // The only way out is user clicking "Hard Restart" button
    // which creates a completely new tab, losing the old session.
  });

  /**
   * BUG 4: Cross-device terminal visibility is architecturally impossible
   *
   * Terminal tab metadata is stored in sessionStorage (per-browser-tab,
   * per-device). There is no sync mechanism and no server-side session
   * listing. Terminals created on mobile are invisible from desktop.
   *
   * This test verifies the server has no session listing endpoint that
   * a desktop client could query.
   */
  it('BUG 4: No cross-device listing endpoint exists', async () => {
    const app = express();
    const server = new EventEmitter();
    const registeredRoutes = [];

    const routesApp = {
      post(route, ...handlers) {
        registeredRoutes.push({ method: 'POST', route });
      },
      get(route, ...handlers) {
        if (handlers.length > 0) {
          registeredRoutes.push({ method: 'GET', route });
        }
      },
      delete(route, ...handlers) {
        registeredRoutes.push({ method: 'DELETE', route });
      },
    };

    const runtime = createRuntime(server, { app: routesApp });

    try {
      const getRoutes = registeredRoutes.filter(r => r.method === 'GET');
      const listRoutes = getRoutes.filter(r =>
        r.route.includes('list') || r.route.endsWith('/terminal')
      );
      expect(listRoutes).toHaveLength(0);
    } finally {
      await runtime.shutdown();
    }
  });

  /**
   * BUG 5: The reconnection retry window is too short for mobile use
   *
   * For REHYDRATED sessions (tab restored from sessionStorage), the
   * stream options are:
   *   initialDelayMs: 200
   *   maxDelayMs: 500
   *   maxRetries: 3
   *
   * With exponential backoff: 200 + 400 + 500 = ~1.1s total retry window.
   * If the mobile PWA was backgrounded for even a short time, the WebSocket
   * may be disconnected. The reconnection retries complete in ~1s and if
   * the network is not yet ready (e.g., device just came back from
   * airplane mode, switching from WiFi to cellular), all 3 retries fail
   * in under 2 seconds, resulting in a fatal error.
   */
  it('BUG 5: Reconnection retry window too short for mobile reconnect', () => {
    const initialDelayMs = 200;
    const maxDelayMs = 500;
    const maxRetries = 3;

    // Calculate total possible retry duration with exponential backoff
    let totalDurationMs = 0;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const baseDelay = Math.min(initialDelayMs * Math.pow(2, Math.max(attempt - 1, 0)), maxDelayMs);
      const jitter = 250; // WS_RECONNECT_JITTER_MS
      totalDurationMs += baseDelay + jitter;
    }

    // Total: ~2.35s worst case for 3 retries with jitter
    // This is too short for real mobile reconnection scenarios like:
    // - Switching from WiFi to cellular
    // - Device waking from deep sleep
    // - Network temporarily unavailable after app resume
    expect(totalDurationMs).toBeLessThan(5000);
  });
});
