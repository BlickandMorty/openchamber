# Epistemos Patch Ledger

Every **in-place edit** to upstream OpenChamber files in this vendored fork gets a row
here. Epistemos-owned NEW files live under `packages/ui/src/epistemos/`,
`packages/web/src/epistemos/`, and `packages/web/server/lib/goose/` and do NOT need
rows (they can never conflict with upstream). On every upstream merge, walk this table
and re-verify each hunk survived.

Vendor base: cloned upstream `74167285` (v1.13.9-6, 2026-07-03).
Build flavor switch: `VITE_EPISTEMOS_EMBED=1` (build time) + `EPISTEMOS_EMBED=1`
(server runtime, set by the Swift supervisor). Without them the fork builds/behaves
stock-upstream.

| ID | File | Hunk | Why |
|---|---|---|---|
| R2a | `packages/web/vite.config.ts` | `epistemosEmbed` const + `VitePWA` plugin wrapped in `...(epistemosEmbed ? [] : [VitePWA({...})])` | Embed build must emit ZERO service workers (stale-SW vs vendored bundle trap) |
| R2b | `packages/web/vite.config.ts` | conditional alias `virtual:pwa-register` → `src/epistemos/pwaRegisterStub.ts` | With the plugin dropped the virtual module no longer resolves; stub also actively unregisters stale SWs. Keeps `main.tsx` byte-identical to upstream |
| R2c | `packages/ui/src/stores/useUpdateStore.ts` | early-return in `checkForUpdates` when `VITE_EPISTEMOS_EMBED === '1'` | No in-app self-update; update path is upstream merge + app release |
| R2d | `packages/web/server/lib/opencode/openchamber-routes.js` | `/api/openchamber/update-check` answers `{available:false}` and `/api/openchamber/update-install` answers 400 when `EPISTEMOS_EMBED === '1'` | Server-side choke point: covers ALL client callers (useUpdateStore, UpdateDialog.tsx:163, Header.tsx:942 — the latter two were added upstream after the research base) and blocks the package-manager spawn |

| R2e | `packages/web/server/lib/opencode/routes.js` | `/api/opencode/upgrade` → 409 and `/api/opencode/upgrade-status` → `{available:false, source:'embedded'}` when `EPISTEMOS_EMBED === '1'` | The engine is pinned as a matched triple; the attach topology (OPENCODE_SKIP_START) bypasses the donor's own bundled-binary detection, so the OpenCode-update toast appeared in-app (found in the P0 browser probe) |
| P2a | `packages/ui/src/components/chat/ChatInput.tsx` | `data-epistemos-composer="true"` attribute on the composer box div (~:4329) — style hook only, zero behavior change | June bar needs a stable selector; the box has no semantic class and sets radius/bg as inline styles |
| P2b | `packages/ui/src/index.css` | `@import "./epistemos/juneBar.css";` + `@import "./epistemos/landing/landing.css";` after the katex import | Loads the June bar + landing overlays (geometry+color only, measured values in docs/JUNE_SIGNATURE_MEASUREMENTS.md) |
| P2d | `packages/ui/src/components/chat/ChatInput.tsx` + `ChatContainer.tsx` | the new-session draft `<h1>` renders `<EpistemosTypewriterGreeting className="epistemos-typewriter-hero">` with the same localized string; the now-unused local `renderDraftTitle` helpers removed | The REAL landing headline ("What are we working on…?") lives here, not in ChatEmptyState — RetroGaming typewriter is the owner headline signature |
| P2c | `packages/ui/src/components/chat/ChatEmptyState.tsx` | root div gains `epistemos-landing-wash`; the start-new-chat span becomes `<EpistemosTypewriterGreeting text={t('chat.emptyState.startNewChat')} />` | Landing signatures: theme-derived June hero wash + RetroGaming typewriter headline (types the donor's own localized string — copy/i18n stay stock) |
| R6c | `packages/ui/src/lib/theme/cssGenerator.ts` | `generateEpistemosLandingVariables` emits `--landing-hero-wash` (primary.base @ 11% oklch), `--landing-hero-wash-rim` (surface.elevated @ 70%), `--landing-hero-wash-gradient` for every theme | June gradient hook; formula provenance docs/JUNE_SIGNATURE_MEASUREMENTS.md |
| R6d | `packages/web/server/index.js` | import + `registerGooseProxyRoutes(app)` after `setupBaseRoutes` | Mounts the `/goose/*` same-origin proxy (new overlay file `lib/goose/proxy.js`, node:http streaming, X-Secret-Key attached server-side from `EPISTEMOS_GOOSE_PORT`/`EPISTEMOS_GOOSE_SECRET`); inert without the env. Smoke-verified against real goosed: direct-without-secret 401, via-proxy 200 |

| R6b | `packages/ui/src/sync/sync-context.tsx` | import + `registerGooseEventIngest(...)` beside pipeline creation, unregister in the effect cleanup | goose adapter synthetic events (message.part.delta/updated, session.idle) enter `handleEvent` — the exact ingest opencode payloads use — skipping only stream-watchdog bookkeeping (synthetic ≠ transport activity) |
| R6a | `packages/ui/src/lib/opencode/client.ts` | top import + `export const opencodeClient = wrapWithEngineDispatch(new OpencodeService())` | Engine-dispatch seam (overlay `epistemos/engineDispatch.ts`): goose-session calls route to the adapter by index membership; pass-through otherwise. Zero behavior change until the engine chip can create a goose session. event-pipeline.ts stays UNTOUCHED — the bridge feeds `handleEvent` directly, so the reserved R6b pipeline hunk proved unnecessary |
| P3a | `packages/ui/src/components/chat/ChatInput.tsx` | import + `<EpistemosEngineChip visible={newSessionDraftOpen} />` after the permission auto-accept button in the desktop toolbar cluster | Per-conversation engine chip (§0.3): sets the one-shot creation intent consumed by the dispatch createSession route; renders ONLY for new drafts and ONLY when /goose/status answers — goose-less builds stay byte-identical |
| P3b | `packages/ui/src/stores/globalSessions.ts` | import + goose-append loop before `return all` in `listGlobalSessionPages` | ONE merged session list (§0.3): adapter-index rows (goosed has no list endpoint) join the same assembly honoring directory/archived filters; dedup via the existing seenIds |
| P3c | `packages/ui/src/components/session/sidebar/SessionNodeItem.tsx` | `epistemosEngineBadge` computed beside sessionTitle + appended at both title render sites | Engine badge on goose rows (version === 'goose' from the adapter mapping); opencode rows unchanged |
| R6e | `packages/ui/src/sync/session-actions.ts` | goose branches at the top of `respondToPermission` + `dismissPermission` (reply via adapter POST /goose/action-required/tool-confirmation, snake_case actions, then synthetic permission.replied) | Permission replies use the raw SDK reply client, bypassing the singleton dispatch; §3 corrected payload verified in goose source (Permission serde snake_case; principal_type defaults to Tool) |
