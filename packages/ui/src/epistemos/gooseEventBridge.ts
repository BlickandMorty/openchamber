// EPISTEMOS overlay (Plan 1-PRO §3, wiring step 1 — docs/GOOSE_ENGINE_WIRING.md):
// the goose adapter feeds SYNTHETIC pipeline payloads (message.part.delta /
// message.part.updated / session.idle, SDK Event-shaped) into the same ingest
// the SyncProvider uses for opencode events. The provider registers its
// handler here (ledger row R6b); the adapter emits through it. Synthetic
// events deliberately skip the stream-health watchdog — they are not
// transport activity.

import type { Event } from '@opencode-ai/sdk/v2/client';
// Side-effect: registers the native-chrome intent listener alongside the
// event bridge (both are epistemos<->SPA seams loaded via SyncProvider).
import '@/epistemos/chromeIntents';

type GooseEventIngest = (directory: string, payload: Event) => void;

let activeIngest: GooseEventIngest | null = null;

/** Called by SyncProvider on mount; returns the unregister cleanup. */
export const registerGooseEventIngest = (ingest: GooseEventIngest): (() => void) => {
    activeIngest = ingest;
    return () => {
        if (activeIngest === ingest) {
            activeIngest = null;
        }
    };
};

/** Emit a synthetic pipeline payload. False when no provider is mounted yet. */
export const emitGooseEvent = (directory: string, payload: Event): boolean => {
    if (!activeIngest) return false;
    activeIngest(directory, payload);
    return true;
};
