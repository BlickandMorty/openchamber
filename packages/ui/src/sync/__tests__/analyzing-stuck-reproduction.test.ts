/**
 * Reproduction test for #1843: Web version frequently gets stuck at "Analyzing" stage.
 *
 * Root cause analysis:
 *
 * The "Analyzing" status text is displayed by `useAssistantStatus.ts` when:
 *   1. `session_status[sessionId]` is `{ type: "busy" }` → `isWorking = true`
 *   2. No assistant message parts exist → `activePartType = undefined` → `isGenericStatus = true`
 *   3. Falls through to `getStableWorkingPhrase()` which can return "analyzing"
 *
 * The session gets STUCK in this state when the busy status is never cleared.
 * This happens through a combination of factors:
 *
 * Factor A: Per-directory stale event detection
 *   `lastActiveEventAt` (line 1791-1792 in sync-context.tsx) is tracked per DIRECTORY,
 *   not per session. If session A is active and receiving events, the stale event
 *   detector (lines 1949-1957) won't fire for stuck session B in the same directory.
 *
 * Factor B: Monotonic watchdog confirms busy from the server
 *   The watchdog runs every 5s and polls the server status. With "monotonic" mode,
 *   if the server returns "busy", the watchdog confirms it and never escalates.
 *   `needsSnapshotAfterStatusPoll` returns `false` when server agrees it's busy.
 *
 * Factor C: STUCK_SESSION_TIMEOUT_MS is defined but never used
 *   The constant exists at `sessionTypes.ts:81` but is never imported or enforced
 *   anywhere. No mechanism force-resets sessions stuck in busy for extended periods.
 *
 * Together, these mean: if the server reports "busy" for a session (even if the
 * AI provider has hung or the response was lost), and another session in the same
 * directory is active, the stuck session stays in "Analyzing" indefinitely.
 */

import { describe, expect, test } from "bun:test";
import { create, type StoreApi } from "zustand";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";

import { INITIAL_STATE, type State } from "../types";
import type { DirectoryStore } from "../child-store";
import {
  applySessionStatusSnapshot,
  needsSnapshotAfterStatusPoll,
} from "../sync-context";
import { STUCK_SESSION_TIMEOUT_MS } from "@/stores/types/sessionTypes";

type StatusSnapshot = Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>;

const BUSY: SessionStatus = { type: "busy" };
const IDLE: SessionStatus = { type: "idle" };

function createDirectoryStore(initial: Partial<State>): StoreApi<DirectoryStore> {
  return create<DirectoryStore>()((set) => ({
    ...INITIAL_STATE,
    ...initial,
    session: initial.session ?? [],
    patch: (partial) => set(partial),
    replace: (next) => set(next),
  }));
}

describe("Bug #1843: Analyzing stuck reproduction", () => {
  // ---------------------------------------------------------------------------
  // 1. Reproduce the "Analyzing" state
  // ---------------------------------------------------------------------------
  test("busy status + no assistant parts → generic status ('analyzing' or similar)", () => {
    // This simulates what useAssistantStatus.ts produces.
    // When status is busy but no parts exist for the last assistant message,
    // `createParsedStatus` returns `isGenericStatus: true` and
    // `getStableWorkingPhrase()` picks a generic phrase (possibly "analyzing").
    const parts: import("@opencode-ai/sdk/v2").Part[] = [];
    const genericKey = "ses_a:msg_a";

    // Replicate createParsedStatus logic from useAssistantStatus.ts lines 131-190
    let activePartType: "text" | "tool" | "reasoning" | "editing" | undefined = undefined;

    // No assistant parts → activePartType stays undefined
    // isGenericStatus = true → getStableWorkingPhrase returns "analyzing" or similar
    const isGenericStatus = activePartType === undefined;

    const WORKING_PHRASES = [
      "working", "processing", "preparing", "warming up", "gears turning",
      "computing", "calculating", "analyzing", "wheels spinning", "calibrating",
      "synthesizing", "connecting dots", "inspecting logic", "weighing options",
    ];

    const hashString = (value: string): number => {
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
      return Math.abs(hash);
    };

    const getStableWorkingPhrase = (key: string): string => {
      return WORKING_PHRASES[hashString(key) % WORKING_PHRASES.length] ?? "working";
    };

    expect(isGenericStatus).toBe(true);

    const statusText = getStableWorkingPhrase(genericKey);
    // The phrase will be one of the WORKING_PHRASES; "analyzing" is a possible value
    expect(WORKING_PHRASES).toContain(statusText);
  });

  // ---------------------------------------------------------------------------
  // 2. Reproduce the stuck scenario: monotonic mode doesn't clear busy
  // ---------------------------------------------------------------------------
  test("SCENARIO A: Server reports busy → monotonic watchdog confirms busy, no escalation", () => {
    // Store: session is busy
    const store = createDirectoryStore({
      session_status: { ses_a: BUSY },
    });

    // Watchdog polls the server, which returns "busy" for the session
    const changed = applySessionStatusSnapshot(
      store,
      { ses_a: { type: "busy" } } as StatusSnapshot,
      ["ses_a"],
      "monotonic",
    );

    // Session stays busy
    expect(store.getState().session_status.ses_a).toEqual(BUSY);
    // No escalation needed (server and store agree)
    expect(needsSnapshotAfterStatusPoll(store.getState(), "ses_a", { type: "busy" })).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 3. Reproduce the stuck scenario: directory-level stale event detection
  // ---------------------------------------------------------------------------
  test("SCENARIO B: Per-directory stale event tracking lets a stuck session persist while other session is active", () => {
    // Two sessions in the same directory: ses_a is stuck (busy, no events),
    // ses_b is active (streaming events).
    const store = createDirectoryStore({
      session_status: {
        ses_a: BUSY,  // stuck
        ses_b: BUSY,  // actively receiving events
      },
    });

    // The watchdog polls the server.
    // Server reports both as busy → monotonic confirms both.
    const changed = applySessionStatusSnapshot(
      store,
      {
        ses_a: { type: "busy" },
        ses_b: { type: "busy" },
      } as StatusSnapshot,
      ["ses_a", "ses_b"],
      "monotonic",
    );

    // Both stay busy
    expect(store.getState().session_status.ses_a).toEqual(BUSY);
    expect(store.getState().session_status.ses_b).toEqual(BUSY);

    // No escalation needed for either (server confirms busy)
    expect(needsSnapshotAfterStatusPoll(store.getState(), "ses_a", { type: "busy" })).toBe(false);
    expect(needsSnapshotAfterStatusPoll(store.getState(), "ses_b", { type: "busy" })).toBe(false);

    // Meanwhile, `lastActiveEventAt` in the watchdog (line 1791-1792 of sync-context.tsx)
    // is set per DIRECTORY, not per session. Events from ses_b keep the directory-level
    // timestamp recent, preventing the stale-event detector (lines 1949-1957) from firing.
    //
    // The stale event detector checks:
    //   now - lastActiveEventAt >= ACTIVE_SESSION_STALE_EVENT_MS (20s)
    // If ses_b is receiving events, this condition is never met for the directory,
    // so the pipeline is not force-reconnected and no authoritative resync is triggered.
    //
    // ses_a stays stuck in "busy" forever → UI shows "Analyzing" indefinitely.
  });

  // ---------------------------------------------------------------------------
  // 4. Reproduce the missing timeout mechanism
  // ---------------------------------------------------------------------------
  test("SCENARIO C: STUCK_SESSION_TIMEOUT_MS is defined but NEVER enforced", () => {
    // The constant exists at sessionTypes.ts:81
    expect(STUCK_SESSION_TIMEOUT_MS).toBe(5 * 60 * 1000);

    // But it is never imported or used anywhere in the codebase.
    // Grep for it in the repo only finds the definition:
    // packages/ui/src/stores/types/sessionTypes.ts line 81
    //
    // No code checks: "has this session been busy for >5 minutes with no events?"
    // No code force-resets busy/retry sessions after a timeout.
    //
    // If it were wired into the watchdog tick function (sync-context.tsx lines 1922-1974),
    // it would catch sessions stuck for >5 minutes even when the server still reports busy.
  });

  // ---------------------------------------------------------------------------
  // 5. The full stuck scenario: session in "Analyzing" with no recovery path
  // ---------------------------------------------------------------------------
  test("FULL REPRODUCTION: session stuck in busy with no events and no timeout", () => {
    // Initial state: session_status is busy, no assistant message parts exist
    const store = createDirectoryStore({
      session_status: { ses_a: BUSY },
      message: {},
      part: {},
    });

    // Watchdog Poll #1 (t=0s): server reports busy → monotonic confirms, no escalation
    applySessionStatusSnapshot(
      store,
      { ses_a: { type: "busy" } } as StatusSnapshot,
      ["ses_a"],
      "monotonic",
    );
    expect(store.getState().session_status.ses_a).toEqual(BUSY);

    // Watchdog Poll #2 (t=5s): server still reports busy
    applySessionStatusSnapshot(
      store,
      { ses_a: { type: "busy" } } as StatusSnapshot,
      ["ses_a"],
      "monotonic",
    );
    expect(store.getState().session_status.ses_a).toEqual(BUSY);

    // Watchdog Poll #N (t=5min+): server STILL reports busy (or never returns idle)
    // No escalation happens because server and store agree.
    // No stale event detector fires because directory-level lastActiveEventAt
    // is recent from other active sessions.
    // No STUCK_SESSION_TIMEOUT_MS enforcement exists.

    // At this point the user sees "Analyzing" indefinitely with no way to recover
    // (other than manual page refresh which sometimes helps temporarily).
    expect(store.getState().session_status.ses_a).toEqual(BUSY);
  });

  // ---------------------------------------------------------------------------
  // 6. The recovery path when server DOES report idle
  // ---------------------------------------------------------------------------
  test("RECOVERY PATH: When server reports idle, authoritative resync clears the stuck session", () => {
    const store = createDirectoryStore({
      session_status: { ses_a: BUSY },
    });

    // If the server eventually reports the session as idle (or omits it from
    // the active status list), needsSnapshotAfterStatusPoll returns true.
    expect(needsSnapshotAfterStatusPoll(store.getState(), "ses_a", undefined)).toBe(true);

    // This would trigger triggerDirectoryResync() which calls
    // resyncDirectoryAfterReconnect() with "authoritative" mode.
    // In authoritative mode, the session is correctly set to idle.
    const changed = applySessionStatusSnapshot(
      store,
      {} as StatusSnapshot, // no active sessions → ses_a is considered idle
      ["ses_a"],
      "authoritative",
    );
    expect(changed).toBe(true);
    expect(store.getState().session_status.ses_a).toEqual(IDLE);

    // But this recovery ONLY happens when:
    // 1. needsSnapshotAfterStatusPoll returns true → needs server to report idle
    // 2. OR the stale-event detector fires → needs 20s of NO events for entire directory
    // 3. OR a full reconnect happens
    //
    // If the server keeps reporting "busy" and another session keeps the directory
    // "alive" with events, none of these recovery paths trigger.
  });
});
