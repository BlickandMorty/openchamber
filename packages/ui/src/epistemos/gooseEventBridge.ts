// EPISTEMOS overlay (Plan 1-PRO §3, wiring step 1 — docs/GOOSE_ENGINE_WIRING.md):
// the goose adapter feeds SYNTHETIC pipeline payloads (message.part.delta /
// message.part.updated / session.idle, SDK Event-shaped) into the same ingest
// the SyncProvider uses for opencode events. The provider registers its
// handler here (ledger row R6b); the adapter emits through it. Synthetic
// events deliberately skip the stream-health watchdog — they are not
// transport activity.

import type { Event } from '@opencode-ai/sdk/v2/client';
// NOTE: chromeIntents is deliberately NOT imported here. This module sits on
// the opencodeClient eval chain (client.ts -> engineDispatch -> here); pulling
// chromeIntents (-> session-ui-store -> client.ts) closed a module cycle that
// broke SPA boot with a TDZ ReferenceError ("Cannot access 'P' before
// initialization" — caught live twice by the render probe). SyncProvider
// imports chromeIntents instead (see R6b hunk).

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
