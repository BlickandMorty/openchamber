// EPISTEMOS overlay (Plan 1-PRO §3, R6a — docs/GOOSE_ENGINE_WIRING.md):
// the engine-dispatch seam. The UI keeps calling the `opencodeClient`
// singleton; this wrapper routes calls that target a GOOSE session (by
// adapter-index membership — ids never parsed) to the goose adapter and
// passes everything else through untouched. With no goose sessions in the
// index, every call passes through — zero behavior change until the engine
// chip creates one.

import { gooseEngineClient } from '@/epistemos/gooseClient';
import { emitGooseEvent } from '@/epistemos/gooseEventBridge';
import {
    gooseAssistantMessageInfo,
    gooseConversationToSdkMessages,
    gooseMessageUpdatedEvent,
    goosePartDeltaEvent,
    goosePartUpdatedEvent,
    gooseSessionIdleEvent,
    gooseSessionToSdkSession,
    gooseTextPart,
    gooseUserMessageInfo,
} from '@/epistemos/gooseSdkMapping';

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
    getSession: (args, passthrough) => {
        const sessionId = firstArgSessionId(args);
        if (!sessionId || engineForSession(sessionId) !== 'goose') return passthrough();
        const indexEntry = gooseEngineClient
            .listIndexedSessions()
            .find((entry) => entry.id === sessionId);
        if (!indexEntry) return passthrough();
        return gooseEngineClient
            .getSession(sessionId)
            .then((session) => gooseSessionToSdkSession(session, indexEntry))
            .catch(() => gooseSessionToSdkSession(undefined, indexEntry));
    },
    getSessionMessages: (args, passthrough) => {
        const sessionId = firstArgSessionId(args);
        if (!sessionId || engineForSession(sessionId) !== 'goose') return passthrough();
        const indexEntry = gooseEngineClient
            .listIndexedSessions()
            .find((entry) => entry.id === sessionId);
        if (!indexEntry) return passthrough();
        return gooseEngineClient
            .getSession(sessionId)
            .then((session) =>
                gooseConversationToSdkMessages(sessionId, indexEntry.workingDir, session.conversation),
            )
            .catch(() => []);
    },
    sendMessage: (args, passthrough) => {
        const params = args[0];
        if (!params || typeof params !== 'object') return passthrough();
        const sessionId = (params as { id?: unknown }).id;
        if (typeof sessionId !== 'string' || engineForSession(sessionId) !== 'goose') {
            return passthrough();
        }
        const indexEntry = gooseEngineClient
            .listIndexedSessions()
            .find((entry) => entry.id === sessionId);
        if (!indexEntry) return passthrough();

        const directory = indexEntry.workingDir;
        const typed = params as { text?: unknown; prefaceText?: unknown; messageId?: unknown };
        const preface = typeof typed.prefaceText === 'string' ? typed.prefaceText.trim() : '';
        const body = typeof typed.text === 'string' ? typed.text : '';
        const userText = preface.length > 0 ? `${preface}\n\n${body}` : body;
        const userMessageId =
            typeof typed.messageId === 'string' && typed.messageId.length > 0
                ? typed.messageId
                : `gmsg-${Date.now().toString(16)}`;

        // Optimistic user message through the donor pipeline (first-token
        // doctrine: the user's message paints instantly).
        emitGooseEvent(directory, gooseMessageUpdatedEvent(sessionId, gooseUserMessageInfo(sessionId, userMessageId)));
        if (userText.length > 0) {
            emitGooseEvent(directory, goosePartUpdatedEvent(sessionId, gooseTextPart(sessionId, userMessageId, userText)));
        }

        const seenAssistantIds = new Set<string>();
        const latestTextByMessage = new Map<string, string>();

        gooseEngineClient.prompt(sessionId, userText, {
            onMessage: (message) => {
                if (message.role !== 'assistant') return;
                const messageId =
                    typeof message.id === 'string' && message.id.length > 0
                        ? message.id
                        : `${sessionId}-assistant-live`;
                if (!seenAssistantIds.has(messageId)) {
                    seenAssistantIds.add(messageId);
                    emitGooseEvent(
                        directory,
                        gooseMessageUpdatedEvent(
                            sessionId,
                            gooseAssistantMessageInfo(sessionId, messageId, directory, { parentID: userMessageId }),
                        ),
                    );
                }
            },
            onTextDelta: (messageId, appendedText, fullText) => {
                latestTextByMessage.set(messageId, fullText);
                emitGooseEvent(directory, goosePartDeltaEvent(sessionId, messageId, appendedText));
            },
            onFinish: () => {
                // Converge every streamed message on its full text, then idle.
                for (const [messageId, fullText] of latestTextByMessage) {
                    emitGooseEvent(directory, goosePartUpdatedEvent(sessionId, gooseTextPart(sessionId, messageId, fullText)));
                    emitGooseEvent(
                        directory,
                        gooseMessageUpdatedEvent(
                            sessionId,
                            gooseAssistantMessageInfo(sessionId, messageId, directory, {
                                parentID: userMessageId,
                                completedSeconds: Math.floor(Date.now() / 1000),
                            }),
                        ),
                    );
                }
                emitGooseEvent(directory, gooseSessionIdleEvent(sessionId));
            },
            onError: (error) => {
                console.warn('[epistemos-goose] reply stream error:', error);
                emitGooseEvent(directory, gooseSessionIdleEvent(sessionId));
            },
        });

        return Promise.resolve(userMessageId);
    },
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
