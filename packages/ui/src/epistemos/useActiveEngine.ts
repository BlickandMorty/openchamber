import { useSyncExternalStore } from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import {
    engineForSession,
    getNextSessionEngine,
    subscribeNextSessionEngine,
    type EngineKind,
} from '@/epistemos/engineDispatch';

// Reactive subscription to the chip's next-session engine intent, so any
// consumer re-renders the INSTANT the chip flips (owner: "it should change
// instantly ... and then change back when I reselect opencode"). getSnapshot
// returns a primitive EngineKind, so useSyncExternalStore is stable.
export const useNextSessionEngine = (): EngineKind =>
    useSyncExternalStore(subscribeNextSessionEngine, getNextSessionEngine, getNextSessionEngine);

/**
 * The engine the composer bar should reflect RIGHT NOW, fully reactively:
 *  - composing a NEW session (draft open, or no current session) → the chip's
 *    live intent (re-renders the moment the chip flips);
 *  - viewing/continuing an EXISTING session → that session's own engine.
 * Every engine-reactive control (model picker, capabilities, command-hiding)
 * shares this resolver so the WHOLE bar flips together and back with zero reload.
 */
/** Pure resolution (testable): draft/no-session → the live intent; existing
 *  session → that session's engine. Extracted so the rule is locked by a test. */
export const resolveActiveEngine = (
    intent: EngineKind,
    currentSessionId: string | null,
    draftOpen: boolean,
    engineOf: (id: string) => EngineKind,
): EngineKind => {
    if (draftOpen || !currentSessionId) return intent;
    return engineOf(currentSessionId);
};

export const useActiveComposerEngine = (): EngineKind => {
    const intent = useNextSessionEngine();
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const draftOpen = useSessionUIStore((s) => Boolean(s.newSessionDraft?.open));
    return resolveActiveEngine(intent, currentSessionId, draftOpen, engineForSession);
};

export const useActiveEngineIsGoose = (): boolean => useActiveComposerEngine() === 'goose';
