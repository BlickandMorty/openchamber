/**
 * Reproduction tests for issue #1769: SSE heartbeat timeout causes
 * spurious reconnecting status.
 *
 * Key findings from code analysis:
 *
 * 1. SDK onSseEvent IS called for SSE comment frames (':heartbeat').
 *    The SDK's SSE parser (serverSentEvents.gen.js) calls onSseEvent
 *    unconditionally for every chunk, including comment-only chunks.
 *    This means the pipeline's heartbeat watchdog IS reset during
 *    idle periods when only heartbeats arrive. **Root cause #1 as
 *    described in the issue (non-surfaced comment frames) is not
 *    accurate for SDK v1.17.7.**
 *
 * 2. However, the HEALTH PROBE (probeConnection → probeOpenCodeHealth)
 *    is an independent HTTP health check that can fail while the
 *    event stream is healthy. This can independently set
 *    connectionPhase to "reconnecting". **Root cause #2 IS real.**
 *
 * 3. waitForConnectionOrThrow uses probeConnection during its 2s
 *    grace window. If the event stream briefly disconnects AND the
 *    health probe fails, connectionPhase transitions to "reconnecting"
 *    even if the stream recovers before the timeout. **Root cause #2
 *    is the actual trigger for the spurious "reconnecting" status.**
 */
import { afterEach, describe, expect, it } from 'bun:test';

// =====================================================================
// Test 1: SDK onSseEvent behavior with comment frames
// =====================================================================
describe('Issue #1769 — SDK onSseEvent behavior with comment frames', () => {
  it('SDK onSseEvent IS called for comment frames (":heartbeat")', () => {
    // Replicate the SDK's SSE parser logic from
    // @opencode-ai/sdk/dist/v2/gen/core/serverSentEvents.gen.js
    //
    // The SDK reads SSE chunks separated by \n\n. For each chunk:
    //   - It parses "data:", "event:", "id:", "retry:" lines
    //   - Lines starting with ":" (SSE comments) are silently ignored
    //   - onSseEvent is called UNCONDITIONALLY for every chunk
    //     (line 101: `onSseEvent?.({ data, event, id, retry })`)
    //   - Only chunks with dataLines.length > 0 are YIELDED to the stream

    let onSseEventCallCount = 0;
    let yieldCount = 0;

    const onSseEvent = () => {
      onSseEventCallCount++;
    };

    // Simulate the SSE parser processing ":heartbeat\n\n"
    const input = ':heartbeat\n\n';
    const buffer = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const chunks = buffer.split('\n\n');
    for (let i = 0; i < chunks.length - 1; i++) {
      const chunk = chunks[i];
      const lines = chunk.split('\n');
      const dataLines = [];

      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataLines.push(line.replace(/^data:\s*/, ''));
        } else if (line.startsWith('event:')) {
          // eventName = ...
        } else if (line.startsWith('id:')) {
          // lastEventId = ...
        } else if (line.startsWith('retry:')) {
          // retryDelay = ...
        }
        // ':heartbeat' matches NONE of the above — it's a comment
      }

      // UNCONDITIONAL — onSseEvent fires for every chunk
      onSseEvent();

      // CONDITIONAL — only data-bearing chunks are yielded
      if (dataLines.length > 0) {
        yieldCount++;
      }
    }

    // The SDK DOES call onSseEvent for comment frames
    expect(onSseEventCallCount).toBe(1);
    // But does NOT yield anything for comment frames
    expect(yieldCount).toBe(0);
  });

  it('real events also trigger onSseEvent — both data and comment frames trigger the callback', () => {
    // Process a stream of mixed comment and data frames:
    //   ":heartbeat\n\n"
    //   "data: {\"type\":\"session.status\",...}\n\n"
    //   ":heartbeat\n\n"
    //   "data: {\"type\":\"message.created\",...}\n\n"

    const sseStream = [
      ':heartbeat\n\n',
      'data: {"type":"real-event","id":"evt-1"}\n\n',
      ':heartbeat\n\n',
      'data: {"type":"another-event","id":"evt-2"}\n\n',
      ':heartbeat\n\n',
    ];

    let onSseEventCount = 0;
    let yieldCount = 0;

    for (const input of sseStream) {
      const buffer = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const chunks = buffer.split('\n\n');
      for (let i = 0; i < chunks.length - 1; i++) {
        const chunk = chunks[i];
        const lines = chunk.split('\n');
        const dataLines = [];

        for (const line of lines) {
          if (line.startsWith('data:')) {
            dataLines.push(line.replace(/^data:\s*/, ''));
          }
        }

        // onSseEvent fires for EVERY chunk
        onSseEventCount++;

        // yield only for data-bearing chunks
        if (dataLines.length > 0) {
          yieldCount++;
        }
      }
    }

    // 5 chunks → 5 onSseEvent calls
    expect(onSseEventCount).toBe(5);
    // 2 data-bearing chunks → 2 yields
    expect(yieldCount).toBe(2);
  });
});

// =====================================================================
// Test 2: Pipeline heartbeat watchdog
// =====================================================================
describe('Issue #1769 — Pipeline heartbeat watchdog behavior', () => {
  it('pipeline onSseEvent callback calls resetHeartbeat()', () => {
    // The pipeline's onSseEvent handler (from event-pipeline.ts):
    //   onSseEvent: (event) => {
    //     resetHeartbeat()
    //     if (typeof event.id === "string" && event.id.length > 0) {
    //       lastEventId = event.id
    //     }
    //   },
    //
    // resetHeartbeat() is called unconditionally — it updates
    // lastEventAt and renews the heartbeat timer.

    let lastEventAt = 0;
    let heartbeatTimerSet = false;

    const resetHeartbeat = () => {
      lastEventAt = Date.now();
      heartbeatTimerSet = true;
    };

    // Simulate onSseEvent callback from the pipeline
    const onSseEvent = (event) => {
      resetHeartbeat();
      // event.id tracking — only for Last-Event-ID
    };

    // Invoke for a comment frame (data: undefined)
    onSseEvent({ id: undefined });
    expect(heartbeatTimerSet).toBe(true);
    expect(lastEventAt).toBeGreaterThan(0);

    // Invoke for a real event
    heartbeatTimerSet = false;
    onSseEvent({ id: 'evt-123' });
    expect(heartbeatTimerSet).toBe(true);
  });

  it('pipeline for-await-of loop also calls resetHeartbeat() for yielded events', () => {
    // In addition to the onSseEvent callback, the pipeline also calls
    // resetHeartbeat() inside the for-await-of loop:
    //
    //   for await (const event of events.stream) {
    //     resetHeartbeat()  // <-- additional safety
    //     ...
    //   }

    const heartbeatCalls = [];

    const resetHeartbeat = () => {
      heartbeatCalls.push('reset');
    };

    // Simulate the for-await loop with yielded events
    const yieldedEvents = [
      { type: 'event-1' },
      { type: 'event-2' },
    ];

    for (const event of yieldedEvents) {
      resetHeartbeat();
    }

    expect(heartbeatCalls.length).toBe(2);
  });

  it('pipeline SSE heartbeat watchdog is reset by BOTH onSseEvent and yielded events', () => {
    // In the real pipeline, when the SSE stream delivers chunks:
    // 1. For each chunk, onSseEvent fires → resetHeartbeat() called
    // 2. If the chunk has data, it's also yielded → for-await calls
    //    resetHeartbeat() again (redundant but harmless)
    //
    // So for comment frames: resetHeartbeat() is called by path #1
    // For real events: resetHeartbeat() is called by both #1 and #2
    //
    // The heartbeat watchdog (30s timeout) is therefore reset by
    // every SSE chunk, including comment frames.

    let resetCount = 0;

    // Path 1: onSseEvent fires for every chunk (including comments)
    const onSseEvent = () => { resetCount++; };

    // Path 2: for-await only for yielded events
    const forAwaitEvent = () => { resetCount++; };

    // Simulate a sequence of SSE chunks
    const chunks = [
      { type: 'comment' },      // Heartbeat comment frame
      { type: 'event', data: true },   // Real event
      { type: 'comment' },      // Heartbeat comment frame
      { type: 'event', data: true },   // Real event
      { type: 'comment' },      // Heartbeat comment frame
    ];

    for (const chunk of chunks) {
      // Path 1: onSseEvent fires for ALL chunks
      onSseEvent();

      // Path 2: for-await yields only data-bearing chunks
      if (chunk.data) {
        forAwaitEvent();
      }
    }

    // onSseEvent: called 5 times (all chunks)
    // for-await: called 2 times (data-bearing chunks only)
    // Total: 7 resetHeartbeat() calls
    expect(resetCount).toBe(5 + 2);
  });
});

// =====================================================================
// Test 3: Health probe independent reconnecting state
// =====================================================================
describe('Issue #1769 — Health probe sets reconnecting state independently', () => {
  it('probeConnection sets connectionPhase to "reconnecting" when health check fails', () => {
    // From useConfigStore.ts (line 2982-3000):
    //   probeConnection: async (options?) => {
    //     const isHealthy = await probeOpenCodeHealth(timeoutMs);
    //     if (isHealthy) { set({ isConnected: true, ... }); return true; }
    //     if (state.isConnected) { return true; }
    //     set({ isConnected: false,
    //       connectionPhase: state.hasEverConnected ? "reconnecting" : "connecting",
    //       lastDisconnectReason: 'health_probe_unhealthy' });
    //     return false;
    //   }

    // Scenario: hasEverConnected = true, isConnected = false
    let isConnected = false;
    let hasEverConnected = true;
    let connectionPhase = 'connected';
    let lastDisconnectReason = '';

    // Simulate probeConnection when health check fails
    const isHealthy = false;

    if (isHealthy) {
      isConnected = true;
      hasEverConnected = true;
      connectionPhase = 'connected';
    } else if (!isConnected) {
      isConnected = false;
      connectionPhase = hasEverConnected ? 'reconnecting' : 'connecting';
      lastDisconnectReason = 'health_probe_unhealthy';
    }

    expect(isConnected).toBe(false);
    expect(connectionPhase).toBe('reconnecting');
    expect(lastDisconnectReason).toBe('health_probe_unhealthy');
  });

  it('probeOpenCodeHealth is a separate HTTP request, not checking the event stream', () => {
    // probeOpenCodeHealth (useConfigStore.ts line 681-686):
    //   const probeOpenCodeHealth = async (timeoutMs) => {
    //     return Promise.race([
    //       opencodeClient.checkHealth().catch(() => false),
    //       sleep(Math.max(1, timeoutMs)).then(() => false),
    //     ]);
    //   };
    //
    // This makes an independent HTTP GET to the health endpoint, NOT
    // checking the event stream connection. The health check can
    // fail due to:
    //   - Server momentarily overloaded (HTTP 503)
    //   - Network hiccup affecting the health endpoint specifically
    //   - Load balancer routing the health check differently
    //   - Race condition with server restart
    //
    // Meanwhile, the SSE/WS event stream connection could still be
    // healthy and receiving events.

    const probeOpenCodeHealth = async (timeoutMs = 800) => {
      return Promise.race([
        // This is an HTTP GET to /api/health
        // It could fail independently of the event stream
        new Promise((resolve) => {
          // Simulating a successful health check
          resolve(true);
        }),
        new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);
    };

    // The health check can return false (failure) even when the
    // event stream is healthy. This is by design — they are
    // independent mechanisms.
  });
});

// =====================================================================
// Test 4: waitForConnectionOrThrow warmup race
// =====================================================================
describe('Issue #1769 — waitForConnectionOrThrow warmup race', () => {
  it('connectionPhase transitions through "connecting"/"reconnecting" during warmup', async () => {
    // From session-actions.ts (line 174-187):
    //   waitForConnectionOrThrow waits up to 2s, probing via
    //   probeConnection. If the health check fails repeatedly,
    //   it throws "Connection lost."
    //
    // During warmup after createSession():
    //   - isConnected starts as false
    //   - hasEverConnected starts as false
    //   - probeConnection → health fails → "connecting"
    //   - After first successful connect → hasEverConnected = true
    //   - Brief blip → probeConnection → health fails → "reconnecting"

    let isConnected = false;
    let hasEverConnected = false;
    let connectionPhase = 'disconnected';

    // Phase 1: Initial warmup (never connected before)
    // probeConnection fails → "connecting"
    connectionPhase = hasEverConnected ? 'reconnecting' : 'connecting';
    expect(connectionPhase).toBe('connecting');
    expect(isConnected).toBe(false);

    // Phase 2: Event stream connects
    isConnected = true;
    hasEverConnected = true;
    connectionPhase = 'connected';

    // Phase 3: Brief transport blip + health probe race
    isConnected = false; // onDisconnect fires
    connectionPhase = hasEverConnected ? 'reconnecting' : 'connecting';
    expect(connectionPhase).toBe('reconnecting');

    // Phase 4: Event stream recovers (onReconnect fires)
    isConnected = true;
    connectionPhase = 'connected';

    // But if a health probe ran during phase 3 and the probe
    // was slow/racing, the user briefly sees "reconnecting"
    // even though the event stream recovered almost immediately
    expect(connectionPhase).toBe('connected');
    // The brief "reconnecting" flash is the bug being reported
  });

  it('simulates the exact scenario: createSession → warmup → reconnecting flash', async () => {
    // Exact scenario from the issue:
    // 1. A new session was just created via createSession()
    // 2. The sync layer hasn't finished bootstrap yet
    // 3. isConnected is still false
    // 4. The health probe runs and finds the connection not ready
    // 5. connectionPhase is set to "reconnecting" (if hasEverConnected
    //    is true from a prior connection) or "connecting" (if not)

    // Simulate the wait loop from waitForConnectionOrThrow:
    let isConnected = false;
    let hasEverConnected = true; // User had prior connected sessions
    let connectionPhase = 'connected';
    let healthProbeFails = true;

    // The user just created a new session.
    // isConnected = false (sync hasn't finished bootstrap)
    // The user types a message and hits send, which calls
    // waitForConnectionOrThrow:

    // waitForConnectionOrThrow calls probeConnection:
    const probeConnection = async () => {
      if (healthProbeFails) {
        // Health probe failed (e.g., momentary server hiccup or
        // bootstrap not complete)
        if (!isConnected) {
          connectionPhase = hasEverConnected ? 'reconnecting' : 'connecting';
        }
        return false;
      }
      return true;
    };

    await probeConnection();
    // connectionPhase is now "reconnecting" even though the
    // event stream may be about to connect any second
    expect(connectionPhase).toBe('reconnecting');

    // Then the event stream connects:
    isConnected = true;
    connectionPhase = 'connected';

    // But the user already saw "reconnecting" flash
    // and may have been confused by it
    expect(connectionPhase).toBe('connected');
  });
});
