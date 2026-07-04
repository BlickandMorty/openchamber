// EPISTEMOS overlay (Plan 1-PRO §3, wiring step 2 — docs/GOOSE_ENGINE_WIRING.md):
// goose -> SDK shape mapping. Every shape below mirrors the EXACT generated
// SDK types at the pinned triple (v2 gen/types.gen.d.ts, read 2026-07-03):
// Session (required: id/slug/projectID/directory/title/version/time),
// UserMessage / AssistantMessage, TextPart, and the event payloads the
// pipeline normalizes (message.updated / message.part.updated /
// message.part.delta / session.idle / session.updated).
//
// Capability truth: mapped values are honest placeholders (cost 0, zero
// tokens, provider/model "goose") — never fabricated engine data.

import type {
    AssistantMessage,
    Event,
    Message,
    Part,
    Session,
    TextPart,
    UserMessage,
} from '@opencode-ai/sdk/v2';
import type { GooseMessage, GooseSession, GooseSessionIndexEntry } from '@/epistemos/gooseClient';

export const GOOSE_ENGINE_TAG = 'goose';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const gooseWorkingDir = (session: GooseSession | undefined, indexEntry?: GooseSessionIndexEntry): string =>
    session?.working_dir || session?.workingDir || indexEntry?.workingDir || '';

export const gooseSessionToSdkSession = (
    session: GooseSession | undefined,
    indexEntry: GooseSessionIndexEntry,
): Session => {
    const directory = gooseWorkingDir(session, indexEntry);
    return {
        id: indexEntry.id,
        slug: indexEntry.id,
        projectID: `goose:${directory}`,
        directory,
        title: session?.name || session?.description || indexEntry.title,
        version: GOOSE_ENGINE_TAG,
        metadata: { epistemosEngine: GOOSE_ENGINE_TAG },
        time: {
            created: Math.floor(indexEntry.createdAt / 1000),
            updated: Math.floor(indexEntry.updatedAt / 1000),
        },
    };
};

const textOfGooseMessage = (message: GooseMessage): string => {
    if (!Array.isArray(message.content)) return '';
    let text = '';
    for (const item of message.content) {
        if (item && typeof item.text === 'string') text += item.text;
    }
    return text;
};

export const gooseTextPartId = (messageId: string): string => `${messageId}-text-0`;

export const gooseTextPart = (sessionId: string, messageId: string, text: string): TextPart => ({
    id: gooseTextPartId(messageId),
    sessionID: sessionId,
    messageID: messageId,
    type: 'text',
    text,
});

export const gooseUserMessageInfo = (
    sessionId: string,
    messageId: string,
    createdSeconds: number = nowSeconds(),
): UserMessage => ({
    id: messageId,
    sessionID: sessionId,
    role: 'user',
    time: { created: createdSeconds },
    agent: GOOSE_ENGINE_TAG,
    model: { providerID: GOOSE_ENGINE_TAG, modelID: GOOSE_ENGINE_TAG },
});

export const gooseAssistantMessageInfo = (
    sessionId: string,
    messageId: string,
    directory: string,
    options: { createdSeconds?: number; completedSeconds?: number; parentID?: string } = {},
): AssistantMessage => ({
    id: messageId,
    sessionID: sessionId,
    role: 'assistant',
    time: {
        created: options.createdSeconds ?? nowSeconds(),
        ...(options.completedSeconds !== undefined ? { completed: options.completedSeconds } : {}),
    },
    parentID: options.parentID ?? '',
    modelID: GOOSE_ENGINE_TAG,
    providerID: GOOSE_ENGINE_TAG,
    mode: GOOSE_ENGINE_TAG,
    agent: GOOSE_ENGINE_TAG,
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

/** Map a full goose conversation to the donor transcript shape. */
export const gooseConversationToSdkMessages = (
    sessionId: string,
    directory: string,
    conversation: GooseMessage[] | undefined,
): { info: Message; parts: Part[] }[] => {
    if (!Array.isArray(conversation)) return [];
    const rows: { info: Message; parts: Part[] }[] = [];
    let lastUserId = '';
    conversation.forEach((message, index) => {
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        const messageId =
            typeof message.id === 'string' && message.id.length > 0
                ? message.id
                : `${sessionId}-${role}-${index}`;
        const createdSeconds =
            typeof message.created === 'number' && Number.isFinite(message.created)
                ? Math.floor(message.created)
                : nowSeconds();
        const text = textOfGooseMessage(message);
        const info: Message =
            role === 'assistant'
                ? gooseAssistantMessageInfo(sessionId, messageId, directory, {
                      createdSeconds,
                      completedSeconds: createdSeconds,
                      parentID: lastUserId,
                  })
                : gooseUserMessageInfo(sessionId, messageId, createdSeconds);
        if (role === 'user') lastUserId = messageId;
        rows.push({
            info,
            parts: text.length > 0 ? [gooseTextPart(sessionId, messageId, text)] : [],
        });
    });
    return rows;
};

// ---------------------------------------------------------------------------
// Synthetic pipeline events (exact SDK payload shapes)
// ---------------------------------------------------------------------------

let syntheticEventCounter = 0;
const syntheticEventId = (): string => {
    syntheticEventCounter += 1;
    return `epistemos-goose-evt-${Date.now()}-${syntheticEventCounter}`;
};

export const gooseMessageUpdatedEvent = (sessionId: string, info: Message): Event => ({
    id: syntheticEventId(),
    type: 'message.updated',
    properties: { sessionID: sessionId, info },
});

export const goosePartUpdatedEvent = (sessionId: string, part: Part): Event => ({
    id: syntheticEventId(),
    type: 'message.part.updated',
    properties: { sessionID: sessionId, part, time: Date.now() },
});

export const goosePartDeltaEvent = (
    sessionId: string,
    messageId: string,
    delta: string,
): Event => ({
    id: syntheticEventId(),
    type: 'message.part.delta',
    properties: {
        sessionID: sessionId,
        messageID: messageId,
        partID: gooseTextPartId(messageId),
        field: 'text',
        delta,
    },
});

export const gooseSessionIdleEvent = (sessionId: string): Event => ({
    id: syntheticEventId(),
    type: 'session.idle',
    properties: { sessionID: sessionId },
});

export const gooseSessionUpdatedEvent = (sessionId: string, info: Session): Event => ({
    id: syntheticEventId(),
    type: 'session.updated',
    properties: { sessionID: sessionId, info },
});

/** goosed toolConfirmationRequest -> the donor's permission.asked shape. */
export const goosePermissionAskedEvent = (
    sessionId: string,
    confirmation: { id: string; toolName?: string; arguments?: unknown; prompt?: string | null },
): Event => ({
    id: syntheticEventId(),
    type: 'permission.asked',
    properties: {
        id: confirmation.id,
        sessionID: sessionId,
        permission: confirmation.toolName || 'tool',
        patterns: [],
        metadata: {
            epistemosEngine: GOOSE_ENGINE_TAG,
            ...(confirmation.prompt ? { prompt: confirmation.prompt } : {}),
            ...(confirmation.arguments !== undefined ? { arguments: confirmation.arguments } : {}),
        },
        always: [],
    },
});

export const goosePermissionRepliedEvent = (
    sessionId: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
): Event => ({
    id: syntheticEventId(),
    type: 'permission.replied',
    properties: { sessionID: sessionId, requestID: requestId, reply },
});
