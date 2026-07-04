# Owner checkpoint — Plan 1 (PRO) build state, 2026-07-04

One overnight loop session. Everything below is committed (fork pushed to
`BlickandMorty/openchamber`; native on `feat/goose-surface`, own files only).
Full row-by-row state: `docs/FEATURE_LEDGER_STATUS.md`. Patch rows:
`docs/PATCH_LEDGER.md`.

## Working and PROVEN (evidence recorded)

- **P0 end-to-end**: the vendored OpenChamber SPA renders inside the Epistemos
  WKWebView (screenshot), served by the supervised web server; SSE + both
  WebSockets same-origin; ZERO service workers; self-updaters stubbed.
- **Instant-open recipe** ported (eager WebPage, off-main spawn, keep-alive
  across tabs, render-probe retry). Perf producers live: signposts + Settings
  health row; budgets wired — initial JS payload **592 KB gz** after fixing the
  bun-layout mega-chunk (was 4010 KB).
- **Dual engine**: opencode attach + goosed third child (optional, capability-
  honest); `/goose/*` proxy with server-side secret (401 without, 200 through);
  adapter (session index — now crash/restart-durable server-side — synthetic
  deltas 8/8 unit-tested, permissions shim with source-verified payloads);
  engine chip; merged sidebar with goose badges.
- **June signatures**: bar + theme-derived gradient (unit-proven on 3 themes +
  custom), RetroGaming typewriter live in-app (screenshot).
- **Native chrome**: toolbar pill (Home/Agent/New Chat/All Chats), native
  all-chats sheet (merged, engine-badged), mascot hook seam.
- **Packaging**: pinned Node 25.8.2 + matched-triple opencode 1.17.12 +
  47 MB web tarball (native-ABI-matched); artifact boots standalone; supervisor
  unpacks version-stamped to Application Support.
- **Phase 5**: crash-orphan sweep (pid+start-time identity, TERM→KILL);
  4-min soak: node 128→102 MB, opencode ~395 MB, goosed 23 MB — stable.

## Needs YOUR eyes (visual checkpoints I can't sign off alone)

1. Open the Agent page: pill, June bar, typewriter, wash — the look. (All
   screenshot-proven already; this is your aesthetic sign-off.)
2. Send an opencode chat turn (P1 gate) — DONE, proven. goose turn (P3 gate)
   — PROVEN at the app-proxy level using YOUR existing cursor-agent config
   (no key needed); UI-visual is one rebuild away.
3. All-chats sheet: open, check grouping/badges, select a session.
4. Settings → Substrate Health → "Agent Surface (Pro)": felt-speed numbers.

## Known-open (deliberate)

- `project.yml` preBuildScripts wiring for `build-openchamber-web.sh` (regen
  rewrites the pbxproj the MAS agent builds against — needs a quiet window;
  run the script manually after fork web changes until then).
- goose-only surfaces (MCP/recipes/scheduler UI) — proxy passes the routes;
  surface design is an owner conversation (§8 row OPEN, honest).
- Upstream-merge cadence dry run (§6) not yet exercised.
- Three historical silent app exits never reproduced under lldb (a 9-min
  supervised run ended in a clean user quit) — watch item only.
