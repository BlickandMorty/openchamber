# §8 Feature Ledger — living status (updated 2026-07-04, post e2e-drive)

The shipping gate. States: **GREEN** (built + verified), **BUILT** (code landed,
verification pending), **PARTIAL**, **OPEN**. No row is marked GREEN without
recorded evidence.

| Feature | State | Evidence / gap |
|---|---|---|
| Project→worktree→session sidebar + pagination | **GREEN (opencode) / BUILT (goose)** | Donor stores untouched; sidebar rendered live in-app (P0 screenshot). goose rows merge via P3b (adapter index, directory-grouped) — e2e visual check pending |
| Chat + streaming + tool UIs + diffs | **GREEN (both engines, e2e — UI-VISUAL for both)** | opencode: keystroke turn streamed "ready" (screenshot). **goose: PROVEN AT BOTH LAYERS** — (API) exact adapter sequence streams real MessageEvent+Finish through the app proxy (`326d8ad8`); (UI-VISUAL, screenshot goose-ui-turn.png) keystroke-send with EPISTEMOS_DEFAULT_ENGINE=goose created a GOOSE session — assistant response header "✧ Goose" + goose badge, sidebar row goose-badged, and goosed prompted for the real cursor-agent keychain cred (owner security boundary — Denied, not bypassed). No owner key needed |
| Permissions/questions | **BUILT (both)** | opencode: donor-stock. goose: shim landed 7d4aa188 (toolConfirmationRequest→permission.asked; reply→/goose/action-required/tool-confirmation, payload verified in goose source). Live confirmation flow untested |
| Files / git panel / terminal PTY | **GREEN (server level)** | Engine-independent web-server routes; PTY WS `{"t":"ok","v":2}` + global-events WS `ready` + SSE verified same-origin (P0 smoke) — in-app panel click-through pending |
| Message queue (reorder) | **GREEN** | Donor messageQueueStore untouched; no engine coupling |
| Providers/models picker | **GREEN (opencode) / PARTIAL (goose)** | opencode: donor config + Keychain→env bridge (bridgedProviderEnvironment, native). goose: /goose/config/providers proxied 200; picker UI for goose sessions not wired (chip default only) |
| MCP extensions / recipes / scheduler | **BACKEND PROVEN / UI = owner design call** | Transport verified live through the proxy 2026-07-04: GET /goose/config/extensions 200 (real MCP list), /goose/recipes/list 200, /goose/schedule/list 200 (docs/GOOSE_ONLY_SURFACES_READINESS.md). Only the UI presentation remains — a §7 Phase-4 owner decision (badge-gated panels vs proxied goose pages) |
| Multi-run / worktrees | **GREEN (opencode)** | Donor-stock; goose sessions excluded by design (no fake parity) |
| Native pill / typewriter / all-chats / mascot hook | **GREEN (visually proven)** | Pill full-render + typewriter + June bar screenshot-visible in-app; ALL-CHATS SHEET RENDERED LIVE 2026-07-04 (auto-presented via EPISTEMOS_OPEN_ALLCHATS DEBUG hook — SwiftUI pill is AX-opaque to scripting): native sheet fetched the REAL merged opencode session list and grouped by directory ("all research"/"jojo" with actual titles). goose badge absent only because no goose session exists yet (correct — needs owner key). Mascot hook = named seam |
| June bar + derived gradient | **GREEN (bar) / BUILT (gradient)** | Bar visible in-app (P0 screenshot). Gradient vars emitted per-theme (R6c); ≥3-theme visual check pending (R7 P2 acceptance) |
| Self-updater + PWA SW | **GREEN** | Embed dist: zero SW artifacts, stub unregisters; update-check/install + opencode upgrade stubbed (R2a–R2e); "embedded" answer verified through the app stack |

## Cross-cutting verification debt (honest list)

1. ~~UI-driven opencode turn~~ DONE (see chat row). Remaining: goose UI turn
   (needs an owner goose provider key), all-chats sheet click-through (AX
   nesting defeated scripted clicking; 1-click owner item), diff/git/terminal
   panel click-throughs.
2. Goose live confirmation flow (needs a goose provider configured + a
   tool-invoking prompt).
3. R7 P2 gradient check on ≥3 themes incl. one custom.
4. Perf budgets: bundle gate GREEN — initial payload 429.9 KB gz vs 3500
   budget (the boot TDZ was an app-code cycle, since fixed; per-package
   split now boots clean, verified in-app). Native signposts + HealthRow
   producers LANDED.
5. Packaging DONE: pinned node 25.8.2 + matched-triple opencode 1.17.12 +
   47MB web tarball staged (build-openchamber-web.sh); artifact boots
   standalone; supervisor unpacks version-stamped. Remaining: project.yml
   preBuildScripts wiring (quiet-window; manual script run until then).
6. Phase-5 soak PASS (4 min, request load): node 128->102MB, opencode ~395MB,
   goosed 23MB — stable, no deaths. Crash-orphan sweep landed natively.
7. Adapter unit tests 8/8 (delta synthesizer + SDK mapping).
