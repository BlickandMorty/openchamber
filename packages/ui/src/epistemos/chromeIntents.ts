// EPISTEMOS overlay (Plan 1-PRO §5/§13.5): native-chrome intent listener.
// The Swift toolbar pill NEVER reloads the SPA URL (that would kill the live
// session); it posts intents that the surface injects as a window
// CustomEvent. This module maps those intents onto donor store actions.
// Self-registers on import (loaded via the epistemos bridge chain).

import { useSessionUIStore } from '@/sync/session-ui-store';

const INTENT_EVENT_NAME = 'epistemos-chrome-intent';

type ChromeIntentDetail = {
    type?: string;
    sessionId?: string;
};

const handleIntent = (detail: ChromeIntentDetail): void => {
    switch (detail.type) {
        case 'newChat':
            useSessionUIStore.getState().openNewSessionDraft();
            break;
        case 'selectSession': {
            const sessionId = typeof detail.sessionId === 'string' ? detail.sessionId : '';
            if (sessionId) {
                useSessionUIStore.getState().setCurrentSession(sessionId);
            }
            break;
        }
        default:
            break;
    }
};

if (typeof window !== 'undefined') {
    window.addEventListener(INTENT_EVENT_NAME, (event) => {
        const detail = (event as CustomEvent<ChromeIntentDetail>).detail;
        if (detail && typeof detail === 'object') {
            handleIntent(detail);
        }
    });
}

export {};
