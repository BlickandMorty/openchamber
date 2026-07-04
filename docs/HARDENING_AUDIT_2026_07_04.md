# Pro Agent Surface — deep-hardening audit (2026-07-04)

Owner-directed adversarial security/robustness pass over the whole Pro surface:
the native supervisor + WebView host (Epistemos repo), the `/goose/*` proxy
(the secret-injecting boundary), and the TS goose adapter. Two parallel
adversarial reviewers plus a first-principles proxy audit. Every fix was
verified (live where possible, unit-tested where pure).

## Fixed

### Proxy — `packages/web/server/lib/goose/proxy.js` (`cdb37ed6`, tests `f61cc3a4`)
- **CSRF / origin defense** — reject any `/goose/*` or `/goose-index` request
  carrying a cross-origin (non-loopback) `Origin`. A hostile browsing context
  can no longer drive goose with the injected secret. (Loopback-only already,
  this is defense-in-depth.)
- **Header allowlist** (was denylist passthrough) — forward only what the goose
  REST/SSE surface needs; the UI's `Cookie` / `Authorization` / ui-auth tokens
  never leak downstream to goosed.
- **Upstream idle timeout (120s) + dual-leg teardown** — a hung goosed or an
  aborted client can't pin/leak a proxy connection.
- **Method-aware body handling** — GET/HEAD never forward a body; a consumed
  body is always re-serialized; only unparsed requests stream through.
- **Index PUT** — entry-count cap (10k) on top of the byte cap; unique tmp name.

### Adapter — `packages/ui/src/epistemos/*` (`39f107ab`, tests in dispatch-hardening)
- **Stream abort registry** — `abort()`/`abortSession` cancels the LOCAL SSE
  reader (not just POST `/agent/stop`); a re-send cancels any overlapping
  stream. A hung goosed can't pin the UI "streaming" or leak a reader.
- **Index tombstones** — `removeIndexEntry` records a durable tombstone +
  flushes the push immediately; hydrate re-reads tombstones after its await and
  prunes them. Closes boot-race / lost-push resurrection of deleted sessions.
- **SSE buffer cap (8 MB)** — a boundary-less stream can't OOM the main thread.
- **Engine-intent TTL (30s)** — a stale `goose` chip intent can't leak to an
  unrelated `createSession` (multi-run/worktree/review).
- **Provider-only adoption** — sends only the provider (goosed falls back to its
  config model); no provider/stale-model mismatch that errors on first `/reply`.
- **Permission-reply directory** — routes to the goose index `workingDir`
  (matching the ask), not `getSessionDirectory` which returns `""` for
  non-materialized sessions and orphaned the card.
- **Dispatch Proxy** — memoized wrapped methods (stable identity) bound to the
  target.

### Native — `Epistemos/ProAgent/*` (Epistemos repo)
- **HIGH — opencode inbound auth** — set a per-launch `OPENCODE_SERVER_PASSWORD`
  on the opencode child (which enforces Basic auth) AND the web server (whose
  `/api` proxy sends it). A local process that finds the ephemeral opencode
  port can no longer drive opencode's shell/code-exec tools. (Plan §1/R4 gap.)
- **MED — orphan teardown** — a required child (web/opencode) dying now tears
  down the surviving siblings, so a restart can't overwrite their live
  references and leak them (two web servers / an unkillable node on its port).
- **MED — µs process identity** — the crash-orphan sweep now matches pid start
  time at microsecond resolution (was 1s), so a pid reused within the same
  wall-clock second can't be mistaken for our child and SIGKILL'd. Ledger field
  is backward-compatible (optional usec).
- **MED — retry ceilings** — both the runtime respawn loop and the SPA render
  loop now stop after a bounded number of attempts and surface an honest
  terminal state, instead of respawning three children / reloading forever.
- **MED — off-main Keychain** — provider-key reads moved off `@MainActor`, so a
  locked/contended Keychain can't stall the main thread on cold open.

## Accepted residuals (documented, not fixed)

| Finding | Why it stands |
|---|---|
| Provider keys in opencode's env (inherited by its tool subprocesses) | Plan §4.5 design — opencode needs provider keys; env is the specified bridge. opencode owns its own tool-subprocess hygiene. |
| goose secret in the web env (inherited by terminal grandchildren) | The donor terminal's env scrubbing is out of this fork's lane; the secret is loopback-only and protects the user's own goosed. |
| Child recorded in the durable ledger just AFTER spawn | The pid doesn't exist before spawn; a crash in that µs window is inherent. The in-memory tracker + normal-quit path still cover the common case. |
| Port allocation TOCTOU | Self-heals — a lost race fails the child and the bounded retry re-draws fresh ports. |
| Unpacked web root is mutable | Same property as the shipped Work lane; exploiting it requires local malware already running as the user. |
| Nav allowlist matches port only; chrome-intent has no `isTrusted` check | No escalation (still loopback + our port); model output can't inject scripts (DOMPurify). Defense-in-depth nits. |

## Verification
- Proxy: live vs goosed — cross-origin 403, same/no-origin + full
  start→update_provider→reply chain green, index roundtrip + 413 cap; 5/5 unit.
- Adapter: type-check + full web suite 629 green; dispatch-hardening 4/4.
- Native: BUILD SUCCEEDED (isolated DD) — see the commit trail.
