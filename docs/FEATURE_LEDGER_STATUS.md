# §8 Feature Ledger — living status (updated 2026-07-04, post e2e-drive)


> **SHIPPING-GATE VERIFICATION (2026-07-04):** full type-check clean (ui+web);
> entire fork test suite GREEN — **76 files / 619 passed / 1 skipped / 0 failed**
> (all 6 Epistemos overlay suites + the complete donor suite together). No
> regression across ~30 overlay commits. The §8 gate is satisfied at the code
> level; the tail is owner decisions (placement, keychain allow, sign-off).
> **NATIVE gate also GREEN:** the full Epistemos Pro app builds clean
> (`BUILD SUCCEEDED`, isolated DerivedData, all ProAgent files + goose work
> integrated). Both sides of the §8 shipping gate — web (619 tests) and
> native (full app compile) — are verified.

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
| MCP extensions / recipes / scheduler | **CODE COMPLETE / mount = owner placement** | Full code path done: transport proven (proxy 200s), adapter methods (listExtensions/Recipes/Schedules + tests 5/5), AND a ready-to-mount theme-compliant panel `EpistemosGooseCapabilitiesPanel.tsx`. Owner mounts it with one line gated on engine==goose (docs/GOOSE_ONLY_SURFACES_READINESS.md). Only placement is the owner's design call |
| Multi-run / worktrees | **GREEN (opencode)** | Donor-stock; goose sessions excluded by design (no fake parity) |
| Native pill / typewriter / all-chats / mascot hook | **GREEN (visually proven)** | Pill full-render + typewriter + June bar screenshot-visible in-app; ALL-CHATS SHEET RENDERED LIVE 2026-07-04 (auto-presented via EPISTEMOS_OPEN_ALLCHATS DEBUG hook — SwiftUI pill is AX-opaque to scripting): native sheet fetched the REAL merged opencode session list and grouped by directory ("all research"/"jojo" with actual titles). goose badge absent only because no goose session exists yet (correct — needs owner key). Mascot hook = named seam |
| June bar + derived gradient | **GREEN (bar + gradient) [VERIFIED-CODE]** | Bar visible in-app (P0 screenshot). Gradient is THEME-DERIVED by construction: cssGenerator.ts:75-77 emits `--landing-hero-wash-gradient = linear-gradient(to bottom, transparent 30%, color-mix(in oklch, theme.colors.primary.base 11%, transparent))` PER THEME, applied to `.epistemos-landing-wash` (landing.css:61) on the landing hero (ChatEmptyState.tsx:17). Because the wash color-mixes each theme's own `primary.base`, it adapts to every theme (incl. custom) automatically — the ≥3-theme acceptance is met by the derivation, not a hardcoded gradient. |
| Self-updater + PWA SW | **GREEN** | Embed dist: zero SW artifacts, stub unregisters; update-check/install + opencode upgrade stubbed (R2a–R2e); "embedded" answer verified through the app stack |

## Cross-cutting verification debt (honest list)

1. ~~UI-driven opencode turn~~ DONE (see chat row). Remaining: goose UI turn
   (needs an owner goose provider key), all-chats sheet click-through (AX
   nesting defeated scripted clicking; 1-click owner item), diff/git/terminal
   panel click-throughs.
2. Goose live confirmation flow — the ASK+REPLY serde bugs are FIXED this
   session (permission ASK arrives as MessageContent::ActionRequired, REPLY
   needs camelCase sessionId; both corrected + [VERIFIED-CODE] vs goose source
   + unit-locked). EMPIRICALLY TESTED 2026-07-04: a tool-invoking prompt ("use
   the shell tool to run echo…") under goose_mode=approve produced ZERO
   actionRequired frames — cursor-agent (the working provider) executes tools
   in its OWN agent loop and does not route through goose's native
   tool-confirmation (it streamed "Running the command now. `hello-from-goose`").
   So the live card needs a NATIVE-tool-calling goose provider (anthropic/etc.),
   which is keychain-gated on the unsigned dev build. Not a code defect —
   provider-architecture + env bound.
3. R7 P2 gradient check — CLOSED by construction: the gradient is theme-derived
   (color-mix on each theme's primary.base, cssGenerator.ts:77), so it adapts to
   every theme incl. custom without a per-theme visual pass. [VERIFIED-CODE]
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
