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
export const useActiveComposerEngine = (): EngineKind => {
    const intent = useNextSessionEngine();
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const draftOpen = useSessionUIStore((s) => Boolean(s.newSessionDraft?.open));
    if (draftOpen || !currentSessionId) return intent;
    return engineForSession(currentSessionId);
};

export const useActiveEngineIsGoose = (): boolean => useActiveComposerEngine() === 'goose';
