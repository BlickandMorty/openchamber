# §8 Feature Ledger — living status (updated 2026-07-04, post-soak)

The shipping gate. States: **GREEN** (built + verified), **BUILT** (code landed,
verification pending), **PARTIAL**, **OPEN**. No row is marked GREEN without
recorded evidence.

| Feature | State | Evidence / gap |
|---|---|---|
| Project→worktree→session sidebar + pagination | **GREEN (opencode) / BUILT (goose)** | Donor stores untouched; sidebar rendered live in-app (P0 screenshot). goose rows merge via P3b (adapter index, directory-grouped) — e2e visual check pending |
| Chat + streaming + tool UIs + diffs | **GREEN (opencode read paths) / BUILT (send+stream both engines)** | Sidebar + session data flowed in-app; Chrome probe showed full workspace. goose streaming (synthetic deltas) landed 4df585d0; UI-driven send awaits an idle window |
| Permissions/questions | **BUILT (both)** | opencode: donor-stock. goose: shim landed 7d4aa188 (toolConfirmationRequest→permission.asked; reply→/goose/action-required/tool-confirmation, payload verified in goose source). Live confirmation flow untested |
| Files / git panel / terminal PTY | **GREEN (server level)** | Engine-independent web-server routes; PTY WS `{"t":"ok","v":2}` + global-events WS `ready` + SSE verified same-origin (P0 smoke) — in-app panel click-through pending |
| Message queue (reorder) | **GREEN** | Donor messageQueueStore untouched; no engine coupling |
| Providers/models picker | **GREEN (opencode) / PARTIAL (goose)** | opencode: donor config + Keychain→env bridge (bridgedProviderEnvironment, native). goose: /goose/config/providers proxied 200; picker UI for goose sessions not wired (chip default only) |
| MCP extensions / recipes / scheduler | **OPEN (Phase 4)** | goose-only surfaces not yet exposed; /goose proxy passes the route groups through (recipes/schedule verified in goosed source) |
| Multi-run / worktrees | **GREEN (opencode)** | Donor-stock; goose sessions excluded by design (no fake parity) |
| Native pill / typewriter / all-chats / mascot hook | **BUILT** | Pill+hook+sheet Swift landed (build queued at write time); typewriter VISIBLE in-app (P0 screenshot). All-chats data path verified at HTTP level (/api/experimental/session + /goose-index) |
| June bar + derived gradient | **GREEN (bar) / BUILT (gradient)** | Bar visible in-app (P0 screenshot). Gradient vars emitted per-theme (R6c); ≥3-theme visual check pending (R7 P2 acceptance) |
| Self-updater + PWA SW | **GREEN** | Embed dist: zero SW artifacts, stub unregisters; update-check/install + opencode upgrade stubbed (R2a–R2e); "embedded" answer verified through the app stack |

## Cross-cutting verification debt (honest list)

1. UI-driven e2e turn (opencode chat + goose chat via chip) — blocked on user-idle
   window; all API-level plumbing beneath verified live.
2. Goose live confirmation flow (needs a goose provider configured + a
   tool-invoking prompt).
3. R7 P2 gradient check on ≥3 themes incl. one custom.
4. Perf budgets: bundle gate WIRED; the per-package split that hit 592KB
   BROKE SPA boot (cross-chunk TDZ) and was REVERTED — payload honestly
   4010.7KB gz vs the 3500 contract (open regression: needs cycle-aware
   splitting; budget conversation for the owner). Native signposts +
   HealthRow producers LANDED.
5. Packaging DONE: pinned node 25.8.2 + matched-triple opencode 1.17.12 +
   47MB web tarball staged (build-openchamber-web.sh); artifact boots
   standalone; supervisor unpacks version-stamped. Remaining: project.yml
   preBuildScripts wiring (quiet-window; manual script run until then).
6. Phase-5 soak PASS (4 min, request load): node 128->102MB, opencode ~395MB,
   goosed 23MB — stable, no deaths. Crash-orphan sweep landed natively.
7. Adapter unit tests 8/8 (delta synthesizer + SDK mapping).
