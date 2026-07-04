# June signature measurements (source-verified 2026-07-03)

Measured from the local June clone (`Epistemos/.research-clones/june`), per Plan 1-PRO §5/R5.
Scope is owner-locked: **message bar + landing gradient ONLY.** Donor fonts stay
(June's ABC Diatype / Martina Plantijn / Berkeley Mono are commercial — never copy).

## Gradient (implemented as PATCH_LEDGER#R6c in cssGenerator.ts)

- `--hero-wash: color-mix(in oklch, var(--brand) 11%, transparent)` — tokens.css:229
- Page wash: `linear-gradient(to bottom, transparent 30%, var(--hero-wash))` — app.css:276 (`.agent-workspace::before`)
- Rim: light `--hero-wash-rim: color-mix(in oklch, var(--card) 70%, transparent)` (tokens.css:230);
  dark override `oklch(100% 0 none / 8%)` (tokens.css:342)
- June reference values (do NOT hardcode — always derive from active theme):
  `--brand: #936862`, light `--background: color-mix(in oklch, oklch(95.13% 0.0015 84.59), var(--brand) 3%)`

Our emission (every theme, incl. custom): `--landing-hero-wash` from `primary.base`,
`--landing-hero-wash-rim` from `surface.elevated`, plus the composed
`--landing-hero-wash-gradient`.

## Message bar (`.agent-composer-box`, app.css:4248)

| Property | June value | Resolved |
|---|---|---|
| border | `1px solid var(--border-subtle)` | border-subtle = `color-mix(in oklch, var(--border) 55%, transparent)` |
| radius | `var(--r-xl)` | **14px** ("squircle, not a pill") |
| background | `var(--card)` | theme card/elevated surface |
| shadow | `var(--shadow-sm)` | `0 1px 2px oklch(24% 0.002 84.59 / 6%)` |
| padding / gap | `var(--sp-1)` / `var(--sp-1)` | 4px / 4px |
| max-width | `min(var(--chat-max), var(--content-max))` | min(680px, 760px) — chat-max scales 768px on wide |
| editor min-height | `var(--control-lg)` | 32px |
| layout | column, `justify-content: flex-end` | toolbar pinned to bottom, editor grows above |
| overflow | hidden | clips focus rings/media to the rounded surface |

Focus state (`.agent-composer-box:focus-within`, app.css:4795):
- `border-color: color-mix(in oklch, var(--ring-focus) 40%, var(--border-subtle))` — deliberately NOT a full focus ring
- `box-shadow: var(--shadow-md)`
- transitions: border-color/box-shadow `var(--t-fast)`=100ms `var(--ease-out)`=cubic-bezier(0.22,1,0.36,1)

Placeholder color: `var(--muted-foreground)` (= `oklch(55.8% 0.0015 84.59)` in June light).

Positioning (informational; OpenChamber keeps its own composer placement):
`.agent-composer` is fixed, bottom `calc(var(--sp-3) + var(--sp-5))` = 20px, centered column,
`pointer-events: none` on the wrapper with `auto` on the box.
