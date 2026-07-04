# Goose-only surfaces — backend readiness (Plan 1-PRO §8, Phase 4)

The §8 row "MCP extensions / recipes / scheduler — goose-only surfaces,
badge-gated" splits cleanly into **transport (mine)** and **UI presentation
(owner design call)**. This documents the transport half, verified live
through the app's same-origin `/goose/*` proxy on 2026-07-04.

## Verified reachable through the proxy (all HTTP 200)

| Capability | Endpoint (verified in goose source @ 8b1d500) | Live result |
|---|---|---|
| MCP extensions (list) | `GET /goose/config/extensions` | `{extensions:[{name:"computercontroller", type:"builtin", …}]}` |
| MCP extensions (add/remove) | `POST /goose/agent/add_extension` / `remove_extension` | route group present |
| Recipes (list) | `GET /goose/recipes/list` | `{manifests:[]}` (empty on a fresh profile) |
| Recipes (encode/decode/scan/save/parse/…) | `POST /goose/recipes/*` | route group present |
| Scheduler (list) | `GET /goose/schedule/list` | `{jobs:[]}` (empty on a fresh profile) |
| Scheduler (create/run_now/pause/kill/inspect) | `/goose/schedule/{id}/*` | route group present |

Correction to earlier notes: the bare `/recipes` and `/schedule` paths 404 —
the real endpoints are `/recipes/list` and `/schedule/list` (GET), plus the
action subpaths above (verified in `crates/goose-server/src/routes/recipe.rs`
and `schedule.rs`). The X-Secret-Key auth is attached server-side by the
proxy, same as every other `/goose/*` route.

## What remains = UI presentation only (owner design call)

These are **goose-only** capabilities — OpenChamber (the donor) has no
recipes/scheduler surface, and its extensions/skills UI is opencode-shaped.
Exposing goose's unique value needs a UI decision that belongs to the owner's
visual language, not an agent's invention:

1. **Badge-gated visibility** — show these surfaces only when a goose session
   is active (the engine badge already exists; `engineForSession` gates it).
2. **Presentation choice** — either (a) build native/donor-styled panels for
   recipes + scheduler + MCP extension manager, or (b) surface goose's own
   web pages (the pre-excision goose surface routed `/recipes` `/skills`
   `/apps` `/schedules` `/extensions` — those pages could be proxied). This is
   the §7 Phase-4 "goose reserved for its unique value" decision.

The backend is proven ready either way; whichever presentation the owner picks
sits on top of the already-working `/goose/*` transport.

## Component ready to mount (2026-07-04)

`packages/ui/src/epistemos/EpistemosGooseCapabilitiesPanel.tsx` is a
self-contained, theme-compliant, read-only panel that renders all three
capabilities via the adapter methods. The owner mounts it wherever the design
calls for — a badge-gated tab, a sidebar section, a settings page — with one
line, gated on the active engine:

```tsx
import { EpistemosGooseCapabilitiesPanel } from '@/epistemos/EpistemosGooseCapabilitiesPanel';
// ...render where you want it, only for goose sessions:
<EpistemosGooseCapabilitiesPanel active={engineForSession(currentSessionId) === 'goose'} />
```

So the goose-only row's ENTIRE code path is complete — transport (proxy),
data access (adapter methods + tests), and presentation (this component). The
only remaining decision is placement, which is deliberately the owner's.

### Placement investigation (why it's genuinely a design call)

Two candidate homes were assessed:

- **Donor Settings section** — would require multi-point edits to the core
  `packages/ui/src/components/views/SettingsView.tsx` (the `SettingsPageSlug`
  type, the `pageOrder` array, the nav sidebar, the render switch, and the
  settings-search index). Invasive to a complex 800-line donor file, and it
  buries goose's live capabilities in global settings.
- **Contextual per-session panel** — mount in the workspace panel area,
  badge-gated to `engineForSession(id) === 'goose'`, alongside the
  diff/git/terminal toggles. More discoverable, but a design choice about the
  donor's chrome.

Both are legitimate; the choice is a real UX decision (management surface vs.
contextual surface) that belongs to the owner. The component is ready for
either — it takes an `active` prop and renders self-contained.

