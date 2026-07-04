// EPISTEMOS overlay (Plan 1-PRO §3, R6a — docs/GOOSE_ENGINE_WIRING.md):
// the engine-dispatch seam. The UI keeps calling the `opencodeClient`
// singleton; this wrapper routes calls that target a GOOSE session (by
// adapter-index membership — ids never parsed) to the goose adapter and
// passes everything else through untouched. With no goose sessions in the
// index, every call passes through — zero behavior change until the engine
// chip creates one.

import { gooseEngineClient } from '@/epistemos/gooseClient';

export type EngineKind = 'opencode' | 'goose';

export const engineForSession = (sessionId: string | undefined | null): EngineKind => {
    if (!sessionId) return 'opencode';
    return gooseEngineClient.listIndexedSessions().some((entry) => entry.id === sessionId)
        ? 'goose'
        : 'opencode';
};

/**
 * v1 dispatch surface: the session-scoped flows goose chat needs. Methods not
 * listed always pass through. Each handler receives the original args and the
 * wrapped service; returning `undefined` (not a promise) falls through to the
 * donor implementation.
 */
type GooseRoute = (args: unknown[], passthrough: () => unknown) => unknown;

const firstArgSessionId = (args: unknown[]): string | null =>
    typeof args[0] === 'string' ? (args[0] as string) : null;

const gooseRoutes: Record<string, GooseRoute> = {
    abortSession: (args, passthrough) => {
        const sessionId = firstArgSessionId(args);
        if (!sessionId || engineForSession(sessionId) !== 'goose') return passthrough();
        return gooseEngineClient.abort(sessionId).then(() => true);
    },
    deleteSession: (args, passthrough) => {
        const sessionId = firstArgSessionId(args);
        if (!sessionId || engineForSession(sessionId) !== 'goose') return passthrough();
        // goosed exposes no session delete; removing the index entry hides the
        // session from OUR merged list honestly (goosed retains its own data).
        gooseEngineClient.removeIndexEntry(sessionId);
        return Promise.resolve(true);
    },
    forkSession: (args, passthrough) => {
        const sessionId = firstArgSessionId(args);
        if (!sessionId || engineForSession(sessionId) !== 'goose') return passthrough();
        return gooseEngineClient.forkSession(sessionId);
    },
    updateSession: (args, passthrough) => {
        const sessionId = firstArgSessionId(args);
        if (!sessionId || engineForSession(sessionId) !== 'goose') return passthrough();
        const patch = args[1];
        const title =
            patch && typeof patch === 'object' && typeof (patch as { title?: unknown }).title === 'string'
                ? ((patch as { title: string }).title)
                : null;
        if (!title) return passthrough();
        return gooseEngineClient.renameSession(sessionId, title);
    },
    // getSession / getSessionMessages / sendMessage: land with the transcript
    // mapping step (docs/GOOSE_ENGINE_WIRING.md order #2) — until then no goose
    // session can be CREATED through the UI, so these can never be reached
    // with a goose id.
};

export const wrapWithEngineDispatch = <T extends object>(service: T): T => {
    return new Proxy(service, {
        get(target, property, receiver) {
            const original = Reflect.get(target, property, receiver);
            if (typeof property !== 'string' || typeof original !== 'function') {
                return original;
            }
            const route = gooseRoutes[property];
            if (!route) {
                return original;
            }
            return (...args: unknown[]) =>
                route(args, () => (original as (...inner: unknown[]) => unknown).apply(target, args));
        },
    });
};
