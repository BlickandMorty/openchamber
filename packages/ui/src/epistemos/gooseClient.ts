// EPISTEMOS overlay (Plan 1-PRO §3): the goose engine adapter — an
// SDK-shaped client over the same-origin /goose/* proxy. The UI never sees
// goosed directly and never holds the secret (attached server-side).
//
// Contracts verified against the local goose source
// (crates/goose-server/src/routes/*, re-checked 2026-07-03):
// - POST /agent/start {working_dir, ...} -> Session (there is NO POST /sessions)
// - POST /reply {user_message, session_id, ...} -> SSE MessageEvent stream
//   (Message | Error | Finish | Notification | UpdateConversation |
//    ActiveRequests | Ping) — whole Message objects, NOT token deltas
// - GET /sessions/{id}; PUT /sessions/{id}/name; POST /sessions/{id}/fork;
//   GET /sessions/{id}/extensions; POST /agent/stop {session_id}
// - GET /config/providers
// - Session LIST does not exist upstream -> the adapter owns its own index
//   (v1 default, Plan §10.1).
//
// Streaming note (§3): goosed streams whole Message objects; this adapter
// diffs successive payloads per message id and emits synthetic delta events.
// Coarser streaming for goose conversations is accepted — honest, not faked.
//
// Transport is swappable: everything below talks REST/SSE through
// `gooseFetch`; the ACP migration replaces the transport without changing
// the adapter surface.

import { runtimeFetch } from '@/lib/runtime-fetch';

const GOOSE_PREFIX = '/goose';
const SESSION_INDEX_STORAGE_KEY = 'epistemos-goose-session-index-v1';

// ---------------------------------------------------------------------------
// Types (tolerant mirrors of the goosed shapes the adapter consumes)
// ---------------------------------------------------------------------------

export type GooseMessageContent = {
    type?: string;
    text?: string;
    [key: string]: unknown;
};

export type GooseMessage = {
    id?: string;
    role?: string;
    created?: number;
    content?: GooseMessageContent[];
    [key: string]: unknown;
};

export type GooseSession = {
    id: string;
    name?: string;
    description?: string;
    working_dir?: string;
    workingDir?: string;
    conversation?: GooseMessage[];
    [key: string]: unknown;
};

export type GooseSessionIndexEntry = {
    id: string;
    title: string;
    workingDir: string;
    createdAt: number;
    updatedAt: number;
};

export type GooseStreamHandlers = {
    /** Synthetic token-delta: the newly appended text for a message id. */
    onTextDelta?: (messageId: string, appendedText: string, fullText: string) => void;
    /** A full (possibly updated) message object arrived. */
    onMessage?: (message: GooseMessage) => void;
    onFinish?: (reason: string) => void;
    onError?: (error: string) => void;
    onNotification?: (requestId: string, payload: unknown) => void;
    onConversationUpdate?: (conversation: GooseMessage[]) => void;
};

// ---------------------------------------------------------------------------
// Adapter-owned session index (localStorage; hydrate rows via GET /sessions/{id})
// ---------------------------------------------------------------------------

const readStoredIndex = (): GooseSessionIndexEntry[] => {
    try {
        const raw = window.localStorage.getItem(SESSION_INDEX_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (entry): entry is GooseSessionIndexEntry =>
                !!entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string',
        );
    } catch {
        return [];
    }
};

const writeStoredIndex = (entries: GooseSessionIndexEntry[]): void => {
    try {
        window.localStorage.setItem(SESSION_INDEX_STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // Quota/private-mode failures degrade to a session-scoped index.
    }
};

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

class GooseRequestError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'GooseRequestError';
        this.status = status;
    }
}

const gooseFetch = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await runtimeFetch(`${GOOSE_PREFIX}${path}`, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...init,
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new GooseRequestError(response.status, body || `goose request failed (${response.status})`);
    }
    return response;
};

const gooseJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await gooseFetch(path, init);
    return (await response.json()) as T;
};

// ---------------------------------------------------------------------------
// Message text extraction + delta synthesis
// ---------------------------------------------------------------------------

const concatenatedText = (message: GooseMessage): string => {
    if (!Array.isArray(message.content)) return '';
    let text = '';
    for (const part of message.content) {
        if (part && typeof part.text === 'string') {
            text += part.text;
        }
    }
    return text;
};

/** Diffs successive whole-message payloads into appended-text deltas. */
export class GooseDeltaSynthesizer {
    private readonly lastTextByMessageId = new Map<string, string>();

    consume(message: GooseMessage): { messageId: string; appendedText: string; fullText: string } | null {
        const messageId = typeof message.id === 'string' && message.id.length > 0 ? message.id : null;
        if (!messageId) return null;
        const fullText = concatenatedText(message);
        const previous = this.lastTextByMessageId.get(messageId) ?? '';
        this.lastTextByMessageId.set(messageId, fullText);
        if (fullText.length <= previous.length || !fullText.startsWith(previous)) {
            // Rewritten or shortened content — treat as a full update, no delta.
            return { messageId, appendedText: '', fullText };
        }
        return { messageId, appendedText: fullText.slice(previous.length), fullText };
    }

    reset(): void {
        this.lastTextByMessageId.clear();
    }
}

// ---------------------------------------------------------------------------
// SSE consumption (fetch-streamed; goosed pings every 500ms)
// ---------------------------------------------------------------------------

type GooseMessageEvent =
    | { type: 'Message'; message: GooseMessage; token_state?: unknown }
    | { type: 'Error'; error: string }
    | { type: 'Finish'; reason: string; token_state?: unknown }
    | { type: 'Notification'; request_id: string; message: unknown }
    | { type: 'UpdateConversation'; conversation: GooseMessage[] }
    | { type: 'ActiveRequests'; [key: string]: unknown }
    | { type: 'Ping' }
    | { type: string; [key: string]: unknown };

const parseSseBlock = (block: string): GooseMessageEvent | null => {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
        }
    }
    if (dataLines.length === 0) return null;
    try {
        return JSON.parse(dataLines.join('\n')) as GooseMessageEvent;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class GooseEngineClient {
    private index: GooseSessionIndexEntry[] = readStoredIndex();

    listIndexedSessions(): GooseSessionIndexEntry[] {
        return [...this.index].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async createSession(workingDir: string): Promise<GooseSession> {
        const session = await gooseJson<GooseSession>('/agent/start', {
            method: 'POST',
            body: JSON.stringify({ working_dir: workingDir }),
        });
        const now = Date.now();
        this.upsertIndexEntry({
            id: session.id,
            title: session.name || session.description || 'goose session',
            workingDir: session.working_dir || session.workingDir || workingDir,
            createdAt: now,
            updatedAt: now,
        });
        return session;
    }

    async getSession(sessionId: string): Promise<GooseSession> {
        return gooseJson<GooseSession>(`/sessions/${encodeURIComponent(sessionId)}`);
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await gooseFetch(`/sessions/${encodeURIComponent(sessionId)}/name`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
        });
        this.touchIndexEntry(sessionId, (entry) => ({ ...entry, title: name, updatedAt: Date.now() }));
    }

    async forkSession(sessionId: string): Promise<GooseSession> {
        const forked = await gooseJson<GooseSession>(`/sessions/${encodeURIComponent(sessionId)}/fork`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        const source = this.index.find((entry) => entry.id === sessionId);
        const now = Date.now();
        this.upsertIndexEntry({
            id: forked.id,
            title: forked.name || (source ? `${source.title} (fork)` : 'goose session (fork)'),
            workingDir: forked.working_dir || source?.workingDir || '',
            createdAt: now,
            updatedAt: now,
        });
        return forked;
    }

    async getSessionExtensions(sessionId: string): Promise<unknown> {
        return gooseJson<unknown>(`/sessions/${encodeURIComponent(sessionId)}/extensions`);
    }

    async abort(sessionId: string): Promise<void> {
        await gooseFetch('/agent/stop', {
            method: 'POST',
            body: JSON.stringify({ session_id: sessionId }),
        });
    }

    async providers(): Promise<unknown> {
        return gooseJson<unknown>('/config/providers');
    }

    removeIndexEntry(sessionId: string): void {
        this.index = this.index.filter((entry) => entry.id !== sessionId);
        writeStoredIndex(this.index);
    }

    /**
     * Send a prompt and stream the reply. Returns an abort function. Whole
     * `Message` payloads are diffed into synthetic text deltas (§3 streaming
     * note); Finish/Error terminate the stream.
     */
    prompt(sessionId: string, userText: string, handlers: GooseStreamHandlers): () => void {
        const abortController = new AbortController();
        const synthesizer = new GooseDeltaSynthesizer();

        const userMessage: GooseMessage = {
            role: 'user',
            created: Math.floor(Date.now() / 1000),
            content: [{ type: 'text', text: userText }],
        };

        void (async () => {
            try {
                const response = await runtimeFetch(`${GOOSE_PREFIX}/reply`, {
                    method: 'POST',
                    headers: {
                        Accept: 'text/event-stream',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ user_message: userMessage, session_id: sessionId }),
                    signal: abortController.signal,
                });
                if (!response.ok || !response.body) {
                    const body = await response.text().catch(() => '');
                    handlers.onError?.(body || `goose reply failed (${response.status})`);
                    return;
                }

                this.touchIndexEntry(sessionId, (entry) => ({ ...entry, updatedAt: Date.now() }));

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffered = '';
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffered += decoder.decode(value, { stream: true });
                    let boundary = buffered.indexOf('\n\n');
                    while (boundary !== -1) {
                        const block = buffered.slice(0, boundary);
                        buffered = buffered.slice(boundary + 2);
                        boundary = buffered.indexOf('\n\n');
                        const event = parseSseBlock(block);
                        if (!event) continue;
                        switch (event.type) {
                            case 'Message': {
                                const message = (event as { message: GooseMessage }).message;
                                handlers.onMessage?.(message);
                                const delta = synthesizer.consume(message);
                                if (delta && delta.appendedText.length > 0) {
                                    handlers.onTextDelta?.(delta.messageId, delta.appendedText, delta.fullText);
                                }
                                break;
                            }
                            case 'UpdateConversation':
                                handlers.onConversationUpdate?.(
                                    (event as { conversation: GooseMessage[] }).conversation,
                                );
                                break;
                            case 'Notification': {
                                const note = event as { request_id: string; message: unknown };
                                handlers.onNotification?.(note.request_id, note.message);
                                break;
                            }
                            case 'Error':
                                handlers.onError?.((event as { error: string }).error);
                                return;
                            case 'Finish':
                                handlers.onFinish?.((event as { reason: string }).reason);
                                return;
                            default:
                                // Ping / ActiveRequests keepalive traffic.
                                break;
                        }
                    }
                }
                // Upstream closed without a Finish frame — report an honest end.
                handlers.onFinish?.('stream-closed');
            } catch (error) {
                if (abortController.signal.aborted) return;
                handlers.onError?.(error instanceof Error ? error.message : 'goose stream failed');
            }
        })();

        return () => abortController.abort();
    }

    private upsertIndexEntry(entry: GooseSessionIndexEntry): void {
        const existing = this.index.findIndex((candidate) => candidate.id === entry.id);
        if (existing === -1) {
            this.index = [...this.index, entry];
        } else {
            this.index = this.index.map((candidate, position) => (position === existing ? entry : candidate));
        }
        writeStoredIndex(this.index);
    }

    private touchIndexEntry(
        sessionId: string,
        update: (entry: GooseSessionIndexEntry) => GooseSessionIndexEntry,
    ): void {
        const existing = this.index.find((entry) => entry.id === sessionId);
        if (!existing) return;
        this.index = this.index.map((entry) => (entry.id === sessionId ? update(entry) : entry));
        writeStoredIndex(this.index);
    }
}

export const gooseEngineClient = new GooseEngineClient();
