# Goose engine wiring design (R6a/R6b) — verified seams, 2026-07-03

Design-first because §8 rates the permissions/streaming rows High-risk. Every hook
below was read in source this session (line refs at vendor base `74167285`).

## Verified seam facts

1. **The UI does not call the SDK directly for session ops** — it calls the
   `OpencodeService` singleton (`packages/ui/src/lib/opencode/client.ts:246`,
   exported as `opencodeClient`): `listSessions` :512, `createSession` :519,
   `getSession` :530, `deleteSession` :539, `getSessionMessages` :567,
   `sendMessage` :741, `abortSession` :960, `forkSession` :1021, plus
   status/todos/commands. **This is the dispatch seam** — no store rewrites needed.
2. **Events enter through one closure**: `createEventPipeline({ sdk, onEvent })`
   (`sync/event-pipeline.ts:228`); the only consumer is `SyncProvider`
   (`sync/sync-context.tsx:1886-1892`) whose handler funnels every payload into
   `applySessionEventToGlobalSessions` (:685) + the per-directory session stores
   (:1350 region). The pipeline normalizes `message.part.delta` /
   `message.part.updated` / `session.status` (`normalizeEventType` :127).
3. **goose session identity**: the adapter owns the id space (index in
   `epistemos/gooseClient.ts`). Collision with opencode ids is avoided by
   construction — goose ids come from goosed and live only in the adapter index;
   the dispatch wrapper decides by membership, not by parsing.

## Wiring plan (all overlay files except two ledgered hunks)

- **`epistemos/engineDispatch.ts` (new)**: wraps the `opencodeClient` methods the
  session flows use. For a session id present in the goose index (or a draft
  tagged goose via the chip), route to `gooseEngineClient`; otherwise pass
  through untouched. Exposes `engineForSession(id): 'opencode' | 'goose'`.
- **`epistemos/gooseEventBridge.ts` (new)**: tiny registry —
  `registerIngest(fn)` called by `SyncProvider` (ledgered hunk R6b, ~3 lines) and
  `emit(directory, payload)` used by the adapter to feed SYNTHETIC pipeline
  payloads: `message.part.updated` + `message.part.delta` built from
  `GooseDeltaSynthesizer` output, `session.idle` on Finish/Error. Payload shapes
  mirror the SDK `Event` types the pipeline already normalizes.
- **`sendMessage` mapping**: goose branch → optimistic user message (donor
  pattern), `gooseEngineClient.prompt(...)`, deltas → bridge emissions targeting
  the same message/part id scheme the transcript uses.
- **Session list merge**: goose index entries → `Session`-shaped rows grouped by
  `workingDir` (directory grouping, NO branch/worktree badges — capability
  truth §0.6) with an `engine: 'goose'` marker carried via session metadata for
  the sidebar badge.
- **Engine chip**: composer-local state defaulting to opencode; only affects
  NEW sessions (a session's engine never changes after creation).
- **Capability hiding**: goose sessions render chat + streaming + permissions
  only; todos/commands/revert/summarize hide when `engineForSession(id) ===
  'goose'` (donor affordances read per-session capability flags — wire at the
  dispatch layer by returning empty/unsupported honestly, never faking).
- **Permissions shim** (§3 corrected payload): goosed `Notification` events
  carrying tool-confirmation requests → donor permission UI; approval POSTs
  `/goose/action-required/tool-confirmation` `{id, principal_type: 'Tool',
  action, session_id}`.

## Order of implementation

1. engineDispatch + gooseEventBridge skeletons; SyncProvider register hunk (R6b).
2. Chat path e2e for goose (create → prompt → synthetic deltas → idle).
3. Sidebar merge + engine badges + directory grouping.
4. Permissions shim; capability hiding sweep.
5. Feature-ledger reconciliation against §8.

Transport stays REST v1 (`/goose/*`); ACP swap replaces gooseClient internals only.
