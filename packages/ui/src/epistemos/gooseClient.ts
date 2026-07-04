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
const SESSION_TOMBSTONE_KEY = 'epistemos-goose-session-tombstones-v1';
// Hardening: cap the SSE reassembly buffer so a goosed that streams bytes
// without a \n\n frame boundary can't grow an unbounded main-thread string.
const SSE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
// Cap the tombstone set so it can't grow forever across a long-lived profile.
const TOMBSTONE_MAX = 2_000;

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

const readTombstones = (): Set<string> => {
    try {
        const raw = window.localStorage.getItem(SESSION_TOMBSTONE_KEY);
        if (!raw) return new Set();
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === 'string')) : new Set();
    } catch {
        return new Set();
    }
};

const writeTombstones = (ids: Set<string>): void => {
    try {
        // Keep only the most recent TOMBSTONE_MAX (insertion order preserved).
        const trimmed = [...ids].slice(-TOMBSTONE_MAX);
        window.localStorage.setItem(SESSION_TOMBSTONE_KEY, JSON.stringify(trimmed));
    } catch {
        // best-effort
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
/**
 * Stable id for goose's live assistant message. goosed streams reply Messages
 * with `id: null` (Message.id is Option<String> and is not set mid-stream), so
 * BOTH the assistant-message event (engineDispatch onMessage) and the text-part
 * events (this synthesizer) MUST fall back to the SAME id — otherwise the part
 * attaches to a phantom message and the bubble renders blank. This shared helper
 * keeps the two in lock-step.
 */
export const gooseLiveAssistantMessageId = (sessionId: string): string => `${sessionId}-assistant-live`;

export class GooseDeltaSynthesizer {
    private readonly lastTextByMessageId = new Map<string, string>();

    consume(
        message: GooseMessage,
        fallbackId: string,
    ): { messageId: string; appendedText: string; fullText: string } | null {
        // goosed sends id:null on the reply message — use the SAME fallback the
        // assistant-message event uses so the text part attaches (was: return
        // null here, which dropped ALL text -> blank replies).
        const messageId =
            typeof message.id === 'string' && message.id.length > 0 ? message.id : fallbackId;
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
    private tombstones: Set<string> = readTombstones();
    private pushTimer: number | null = null;
    // Active /reply streams keyed by session id — so abort() can cancel the
    // local reader, not just POST /agent/stop (a hung stream that never sends
    // Finish would otherwise leak its reader and pin the UI "streaming").
    private activeStreams = new Map<string, () => void>();

    constructor() {
        // The webview runs on a NON-PERSISTENT data store, so localStorage is
        // per-launch only. The web server keeps the durable index copy
        // (/goose-index); hydrate on boot, push on change.
        void this.hydrateFromServer();
    }

    listIndexedSessions(): GooseSessionIndexEntry[] {
        return [...this.index].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    private async hydrateFromServer(): Promise<void> {
        try {
            const response = await runtimeFetch('/goose-index', { headers: { Accept: 'application/json' } });
            if (!response.ok) return;
            const parsed: unknown = await response.json();
            if (!Array.isArray(parsed)) return;
            const serverEntries = parsed.filter(
                (entry): entry is GooseSessionIndexEntry =>
                    !!entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string',
            );
            const byId = new Map<string, GooseSessionIndexEntry>();
            for (const entry of serverEntries) byId.set(entry.id, entry);
            for (const entry of this.index) {
                const existing = byId.get(entry.id);
                if (!existing || entry.updatedAt >= existing.updatedAt) byId.set(entry.id, entry);
            }
            // Re-read tombstones AFTER the await so a delete that happened during
            // the in-flight fetch is honored (closes the boot-race resurrection).
            this.tombstones = readTombstones();
            for (const deletedId of this.tombstones) byId.delete(deletedId);
            this.index = [...byId.values()];
            writeStoredIndex(this.index);
            // Push the reconciled (tombstone-pruned) view back so the durable
            // server copy stops carrying deleted sessions.
            this.schedulePushToServer();
        } catch {
            // Offline/absent goose: the in-memory index still works this launch.
        }
    }

    private pushNow(): void {
        void runtimeFetch('/goose-index', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.index),
        }).catch(() => undefined);
    }

    private schedulePushToServer(): void {
        if (typeof window === 'undefined') {
            this.pushNow();
            return;
        }
        if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
        this.pushTimer = window.setTimeout(() => {
            this.pushTimer = null;
            this.pushNow();
        }, 400);
    }

    /** Immediate durable push (cancels any pending debounce) — for deletes. */
    private flushPushToServer(): void {
        if (typeof window !== 'undefined' && this.pushTimer !== null) {
            window.clearTimeout(this.pushTimer);
            this.pushTimer = null;
        }
        this.pushNow();
    }

    async createSession(workingDir: string): Promise<GooseSession> {
        const session = await gooseJson<GooseSession>('/agent/start', {
            method: 'POST',
            body: JSON.stringify({ working_dir: workingDir }),
        });
        const now = Date.now();
        // A fresh id can never be a tombstone (goosed mints monotonic ids), but
        // clear it defensively so a reused id resurfaces cleanly.
        if (this.tombstones.delete(session.id)) writeTombstones(this.tombstones);
        this.upsertIndexEntry({
            id: session.id,
            title: session.name || session.description || 'goose session',
            workingDir: session.working_dir || session.workingDir || workingDir,
            createdAt: now,
            updatedAt: now,
        });
        // goosed's /agent/start creates a session WITHOUT a provider selected
        // (the Web UI picks one; `/reply` 'Provider not set' otherwise). Adopt
        // the user's own goose config provider so a turn works with zero extra
        // setup. Best-effort: a session with no provider still exists; the reply
        // surfaces the honest goosed error.
        await this.applyConfiguredProvider(session.id).catch(() => undefined);
        return session;
    }

    /** Read a goose config value (verified endpoint: POST /config/read). */
    private async readGooseConfig(key: string): Promise<string | null> {
        try {
            const response = await gooseFetch('/config/read', {
                method: 'POST',
                body: JSON.stringify({ key, is_secret: false }),
            });
            const value = await response.json();
            return typeof value === 'string' ? value : null;
        } catch {
            return null;
        }
    }

    /**
     * Select the user's configured provider on a fresh session. Sends ONLY the
     * provider — goosed's update_provider falls back to the config's own
     * GOOSE_MODEL, so we never risk pairing a provider with a stale model that
     * belongs to a different provider (which would create a session that then
     * errors confusingly on the first /reply). Verified: provider-only returns
     * 200 and the reply streams.
     */
    private async applyConfiguredProvider(sessionId: string): Promise<void> {
        const provider = await this.readGooseConfig('active_provider');
        if (!provider) return;
        await gooseFetch('/agent/update_provider', {
            method: 'POST',
            body: JSON.stringify({ provider, session_id: sessionId }),
        });
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
        // Cancel the LOCAL reader first so a goosed that ignores /agent/stop (or
        // never closes the SSE) can't keep the fetch reader alive emitting
        // synthetic events for a session the user has left.
        const cancelStream = this.activeStreams.get(sessionId);
        if (cancelStream) {
            this.activeStreams.delete(sessionId);
            try {
                cancelStream();
            } catch {
                // ignore
            }
        }
        await gooseFetch('/agent/stop', {
            method: 'POST',
            body: JSON.stringify({ session_id: sessionId }),
        });
    }

    async providers(): Promise<unknown> {
        return gooseJson<unknown>('/config/providers');
    }

    /** Configured goose providers (live-enumerated from goose's own
     *  GET /config/providers), with their display name + known model names.
     *  Only is_configured providers — the ones goose can actually run. */
    async listConfiguredProviders(): Promise<
        Array<{ name: string; displayName: string; models: string[] }>
    > {
        const raw = await this.providers();
        const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
        return list
            .filter((p) => p && p.is_configured === true)
            .map((p) => {
                const meta = (p.metadata ?? {}) as Record<string, unknown>;
                const known = Array.isArray(meta.known_models) ? (meta.known_models as Array<Record<string, unknown>>) : [];
                return {
                    name: String(p.name ?? ''),
                    displayName: String(meta.display_name ?? p.name ?? ''),
                    models: known.map((m) => String(m.name ?? '')).filter(Boolean),
                };
            })
            .filter((p) => p.name.length > 0);
    }

    /** The goose config's currently-selected provider (active_provider). */
    async getActiveProvider(): Promise<string | null> {
        return this.readGooseConfig('active_provider');
    }

    /** Persist the goose config's active_provider (goosed /config/upsert;
     *  UpsertConfigQuery is snake_case: {key, value, is_secret}). Non-secret.
     *  createSession's applyConfiguredProvider reads this, so a provider picked
     *  on a NEW draft (before its session exists) still takes effect on send. */
    async setActiveProvider(provider: string): Promise<void> {
        await gooseFetch('/config/upsert', {
            method: 'POST',
            body: JSON.stringify({ key: 'active_provider', value: provider, is_secret: false }),
        });
    }

    /** Select a goose provider for a running session (goosed update_provider). */
    async setSessionProvider(sessionId: string, provider: string): Promise<void> {
        await gooseFetch('/agent/update_provider', {
            method: 'POST',
            body: JSON.stringify({ provider, session_id: sessionId }),
        });
    }

    // -----------------------------------------------------------------------
    // Goose's RESERVED value (Plan 1-PRO §7 Phase 4): MCP extensions, recipes,
    // scheduler. Typed adapter methods over the verified goosed endpoints
    // (docs/GOOSE_ONLY_SURFACES_READINESS.md) so the owner's future badge-gated
    // UI calls these instead of hand-rolling fetches. Paths corrected:
    // /recipes/list + /schedule/list (bare paths 404).
    // -----------------------------------------------------------------------

    /** MCP extensions available to goose (builtin + user-added). */
    async listExtensions(): Promise<unknown> {
        return gooseJson<unknown>('/config/extensions');
    }

    // goosed AddExtensionRequest/RemoveExtensionRequest (goose-server/src/routes/
    // agent.rs:101/107) have NO rename_all -> snake_case, and BOTH REQUIRE
    // session_id (an agent add/remove is scoped to a running agent session).
    async addExtension(sessionId: string, config: Record<string, unknown>): Promise<unknown> {
        return gooseJson<unknown>('/agent/add_extension', {
            method: 'POST',
            body: JSON.stringify({ session_id: sessionId, config }),
        });
    }

    async removeExtension(sessionId: string, name: string): Promise<unknown> {
        return gooseJson<unknown>('/agent/remove_extension', {
            method: 'POST',
            body: JSON.stringify({ name, session_id: sessionId }),
        });
    }

    /** Recipe manifests (`GET /recipes/list` -> {manifests: [...]}). */
    async listRecipes(): Promise<unknown> {
        return gooseJson<unknown>('/recipes/list');
    }

    /** Scheduled jobs (`GET /schedule/list` -> {jobs: [...]}). */
    async listSchedules(): Promise<unknown> {
        return gooseJson<unknown>('/schedule/list');
    }

    async runScheduleNow(scheduleId: string): Promise<unknown> {
        return gooseJson<unknown>(`/schedule/${encodeURIComponent(scheduleId)}/run_now`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }

    /** goose's live tools/skills for a session (`GET /agent/tools?session_id=`).
     *  Requires a session id (GetToolsQuery.session_id is required, snake_case). */
    async tools(sessionId: string): Promise<unknown> {
        return gooseJson<unknown>(`/agent/tools?session_id=${encodeURIComponent(sessionId)}`);
    }

    /** goose's available apps/CLIs (`GET /agent/list_apps`). */
    async listApps(): Promise<unknown> {
        return gooseJson<unknown>('/agent/list_apps');
    }

    /**
     * Reply to a tool-confirmation request. goosed's ConfirmToolActionRequest is
     * `#[serde(rename_all = "camelCase")]` (goose-server/src/routes/
     * action_required.rs), so the body keys are `{id, action, sessionId}` —
     * `sessionId` (NOT snake_case session_id, which is a required field with no
     * default → a snake_case key fails deserialization and the reply is dropped,
     * hanging the tool). `principalType` is omitted (goosed defaults it to Tool).
     * The `action` VALUES are snake_case — they map to the Permission enum
     * (goose-providers/src/permission.rs, rename_all=snake_case).
     */
    async confirmToolAction(
        sessionId: string,
        confirmationId: string,
        action: 'allow_once' | 'always_allow' | 'deny_once' | 'always_deny' | 'cancel',
    ): Promise<void> {
        await gooseFetch('/action-required/tool-confirmation', {
            method: 'POST',
            body: JSON.stringify({ id: confirmationId, action, sessionId }),
        });
    }

    removeIndexEntry(sessionId: string): void {
        this.index = this.index.filter((entry) => entry.id !== sessionId);
        writeStoredIndex(this.index);
        // Record a tombstone so a stale server copy or an in-flight hydrate
        // can't resurrect this session on the next boot/merge.
        this.tombstones.add(sessionId);
        writeTombstones(this.tombstones);
        // Deletion must be durable immediately — flush now, not on the 400ms
        // debounce (the app may quit before it fires).
        this.flushPushToServer();
    }

    /**
     * Send a prompt and stream the reply. Returns an abort function. Whole
     * `Message` payloads are diffed into synthetic text deltas (§3 streaming
     * note); Finish/Error terminate the stream.
     */
    prompt(sessionId: string, userText: string, handlers: GooseStreamHandlers): () => void {
        const abortController = new AbortController();
        const cancel = () => abortController.abort();
        // Cancel any stream already live for this session so a re-send can't run
        // two overlapping readers (each with its own synthesizer) at once.
        const previous = this.activeStreams.get(sessionId);
        if (previous) {
            try {
                previous();
            } catch {
                // ignore
            }
        }
        this.activeStreams.set(sessionId, cancel);
        const synthesizer = new GooseDeltaSynthesizer();

        const userMessage: GooseMessage = {
            role: 'user',
            created: Math.floor(Date.now() / 1000),
            content: [{ type: 'text', text: userText }],
            // Required by the goose Message struct (verified in source:
            // MessageMetadata { user_visible, agent_visible }, camelCase,
            // no serde default — /reply 422s without it).
            metadata: { userVisible: true, agentVisible: true },
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
                    // Bound the reassembly buffer: a goosed that streams bytes
                    // with no \n\n frame boundary must not grow an unbounded
                    // main-thread string until the tab OOMs.
                    if (buffered.length > SSE_BUFFER_MAX_BYTES) {
                        handlers.onError?.('goose stream frame exceeded buffer limit');
                        try {
                            await reader.cancel();
                        } catch {
                            // ignore
                        }
                        return;
                    }
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
                                const delta = synthesizer.consume(message, gooseLiveAssistantMessageId(sessionId));
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
            } finally {
                // Unregister only if a newer prompt() hasn't already replaced us.
                if (this.activeStreams.get(sessionId) === cancel) {
                    this.activeStreams.delete(sessionId);
                }
            }
        })();

        return cancel;
    }

    private upsertIndexEntry(entry: GooseSessionIndexEntry): void {
        const existing = this.index.findIndex((candidate) => candidate.id === entry.id);
        if (existing === -1) {
            this.index = [...this.index, entry];
        } else {
            this.index = this.index.map((candidate, position) => (position === existing ? entry : candidate));
        }
        writeStoredIndex(this.index);
        this.schedulePushToServer();
    }

    private touchIndexEntry(
        sessionId: string,
        update: (entry: GooseSessionIndexEntry) => GooseSessionIndexEntry,
    ): void {
        const existing = this.index.find((entry) => entry.id === sessionId);
        if (!existing) return;
        this.index = this.index.map((entry) => (entry.id === sessionId ? update(entry) : entry));
        writeStoredIndex(this.index);
        this.schedulePushToServer();
    }
}

export const gooseEngineClient = new GooseEngineClient();
