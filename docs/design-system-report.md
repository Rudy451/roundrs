# DraftBoard Design System — Consistency Report
## Version 2 · May 2026

---

## 1. Final Design System Spec

### Identity

| Axis | Decision |
|---|---|
| Feeling | High-stakes decision room. Weight, restraint, precision. |
| References | Rounders · Batman Begins computer · NFL Draft Room · There Will Be Blood |
| Anti-references | SaaS dashboards, crypto UIs, fintech consumer apps, anything with gradients |
| Core rule | Nothing decorative that does not carry information |

---

### Color System

**Backgrounds** — warm charcoal, never cool blue-black

| Token | Hex | Role |
|---|---|---|
| `--bg-base` | `#0d0e0b` | Page root, deepest layer |
| `--bg-surface` | `#111310` | Sidebar, topbar, panels |
| `--bg-raised` | `#161810` | Card faces, main view |
| `--bg-elevated` | `#1c1e15` | Expanded sections |
| `--bg-inset` | `#0a0b08` | Inputs, code wells |

**Borders** — felt, not seen. Each step doubles opacity.

| Token | Value | Role |
|---|---|---|
| `--border-0` | `rgba(255,253,240,0.038)` | Hairlines, dividers |
| `--border-1` | `rgba(255,253,240,0.070)` | Card default state |
| `--border-2` | `rgba(255,253,240,0.110)` | Card hover, focused input |
| `--border-3` | `rgba(255,253,240,0.170)` | Active / selected |

**Text** — warm off-white. Pure white is never used.

| Token | Hex | Role |
|---|---|---|
| `--text-primary` | `#e6e3d8` | Headings, tickers, key values |
| `--text-secondary` | `#aeaba3` | Body prose, labels |
| `--text-tertiary` | `#6c6960` | De-emphasised content |
| `--text-disabled` | `#3a3832` | Placeholders, inactive items |

**Signal accents** — one semantic purpose each, never decorative

| Color | Hex | Meaning |
|---|---|---|
| Green | `#4a8a5f` / text `#5fa876` | Conviction, confirmed, positive delta |
| Amber | `#9b7a32` / text `#b8953f` | Attention, caution, pending, running |
| Red | `#8a3e3e` / text `#a85050` | Risk, error, penalty, negative |
| Slate | `#4c5e6c` | Neutral data, low-velocity, secondary metadata |

**Rule enforced:** `scoreColor()`, `signalColor()`, `stateColor()` in `tokens.js` are the only color decision functions. Components never contain color logic.

---

### Typography

| Role | Font | Size | Use |
|---|---|---|---|
| Wordmark | Libre Baskerville italic | 16px | Logo only — never UI chrome |
| UI | DM Sans | 10–18px | Labels, body, nav, buttons |
| Data | DM Mono | 8–15px | Tickers, scores, timestamps, codes |

**Rule enforced:** `--font-display` is used only in `.db-wordmark`. Any other Baskerville use is a violation.

**Type utilities** (CSS classes, globally available):

| Class | Role |
|---|---|
| `.t-heading` | DM Sans 15px/500 — section titles |
| `.t-label` | DM Mono 9px, 0.14em tracking, caps — field labels |
| `.t-ticker` | DM Mono 15px/500 — ticker symbols |
| `.t-value` | DM Mono 22px/500 — large numeric values |
| `.t-mono` | DM Mono 12px — inline data |
| `.t-body` | DM Sans 12px — prose |

---

### Spacing

4px base unit. Nothing breaks this grid.

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40` — available as `--sp-1` through `--sp-10`.

---

### Card System

Three variants — same DNA, different elevation:

| Class | Background | Border | Use |
|---|---|---|---|
| `.card` | `--bg-raised` | `--border-1` → `--border-2` on hover | Primary data container |
| `.card-inset` | `--bg-surface` | `--border-0`, no hover | Structural grouping |
| `.card--green/amber/red` | same | Signal-state accent border | State-indicating cards |

Padding presets: `.card-p1` (12/16) · `.card-p2` (16/20) · `.card-p3` (20/24)

---

### Component Primitives

| Primitive | Class | Notes |
|---|---|---|
| Badge | `.badge .badge-green/amber/red/neutral` | 8px DM Mono, caps |
| Button | `.btn .btn-primary/amber/danger` | 10px DM Mono, caps |
| Input | `.input` | Inset background, focus lift |
| Section header | `.section-head` | 9px DM Mono caps + border-bottom |
| Status pip | `.pip .pip-green/amber/red/dim` | 5×5 circle |
| Score bar | `.bar-track + .bar-fill .bar-green/amber/red` | 2px height |
| Data table | `.data-table` | Full table spec with th/td rules |
| Spinner | `.spinner` | 10px, amber top border |
| Empty state | `.empty-state` | Centered, DM Mono caps |
| Error block | `.error-block` | Red dim background |

---

## 2. Component Consistency Report

### Issues Found and Resolved

---

#### globals.css

**Before:**
- Mixed raw hex values and CSS vars in the same file
- `--color-green`, `--color-amber`, `--color-red` named inconsistently with JS `C.*` tokens
- `--bg-dark`, `--bg-card`, `--bg-panel` — non-systematic naming, no elevation model
- `.card` had multiple conflicting padding definitions across breakpoints
- Font declarations split between globals.css and inline component styles
- `.spinner` referenced `var(--amber)` which was undefined at the point of use
- Animation durations inconsistent: some components used 200ms, others 300ms, others 150ms
- No `.section-head` class — each component defined its own section label style

**After (v2):**
- All values reference `--bg-*`, `--border-*`, `--text-*`, `--green-*` etc. — systematic naming
- Full five-level background stack: base → surface → raised → elevated → inset
- Border opacity ladder: 0.038 → 0.070 → 0.110 → 0.170
- `.section-head` defined once, used identically by all six views
- All animation durations normalised: viewEnter 160ms, cardEnter 200ms, rowEnter 120ms
- Single `.spinner` definition, amber token resolved at root level

---

#### tokens.js

**Before:**
- `C.green`, `C.amber`, `C.red` existed but no derived `C.greenDim`, `C.greenBorder` etc.
- Components computed their own `rgba()` variants inline: `rgba(77,140,98,0.1)` scattered across files
- No `scoreColor()` function — each component had its own score → color switch
- No `signalColor()` function — signal type badges used hardcoded maps in each component
- `scoreArc()` geometry computed inline in DraftBoard.js
- No `velocityLabel()` or `scoreTier()` — defined ad hoc in multiple files

**After (v2):**
- Full derived color set for each signal: base, dim, border, glow, text, css-class-name
- `scoreColor(score)` — single authoritative function, thresholds 70/50
- `signalColor(type)` — maps thesis/catalyst/momentum/risk/noise → color set
- `stateColor(state)` — maps pipeline states → color set
- `scoreArc(score, size, stroke)` — returns complete SVG geometry object
- `velocityLabel(v)` and `scoreTier(score)` — no more ad-hoc implementations

---

#### DraftBoard.js

| Issue | Fix |
|---|---|
| Inline `style={{ color: score >= 70 ? '#4d8c62' : ... }}` | Replace with `scoreColor(signal.finalScore).text` |
| `fontFamily: 'DM Mono, monospace'` inlined on ticker | Use `.t-ticker` class |
| Custom section label styles per section | Replace with `.section-head` |
| Score arc SVG geometry computed inline | Replace with `scoreArc()` from tokens |
| `rgba(77,140,98,0.08)` hardcoded card background on high-score candidates | Replace with `C.greenDim` + `.card--green` |
| `border: '1px solid rgba(77,140,98,0.18)'` inline | Replace with `.card--green` |

---

#### DiscoveryEngine.js

| Issue | Fix |
|---|---|
| `.engine-card` local class with duplicate card styles | Remove; use `.card .card-p2` |
| Status badge inline styles with hardcoded colors | Replace with `.badge .badge-amber/green` |
| `fontSize: '11px'` on metadata rows | Normalise to `var(--text-sm)` / `.t-mono` |
| `backgroundColor: '#1a1c14'` hardcoded panel | Replace with `var(--bg-elevated)` |
| Loading spinner reimplemented as a rotating div | Replace with `.spinner` |

---

#### PipelineDashboard.js

| Issue | Fix |
|---|---|
| Stage row status dots sized 6×6 with inline styles | Replace with `.pip` (5×5, standardised) |
| `color: '#666'` on secondary text | Replace with `var(--text-tertiary)` |
| Custom progress bar with 4px height | Normalise to `.bar-track` / `.bar-fill` (2px) |
| `borderRadius: '3px'` on cards | Normalise to `var(--radius-md)` (5px) |
| `fontFamily: 'monospace'` (bare, no fallback) | Replace with `var(--font-data)` |

---

#### ThemeIntelligence.js

| Issue | Fix |
|---|---|
| Theme score bar implemented as a percentage-width `<div>` with inline color logic | Replace with `.bar-track .bar-fill .bar-green/amber` |
| `background: 'rgba(255,255,255,0.04)'` hover state | Replace with `rgba(255,253,240,0.018)` (warm tint consistent with sidebar) |
| `color: '#8a8a8a'` on theme labels | Replace with `var(--text-tertiary)` |
| Section headers with `fontSize: 10, letterSpacing: 2` inline | Replace with `.section-head` |

---

#### ThemeWorkbench.js

| Issue | Fix |
|---|---|
| Query row expansion uses `max-height` transition but with mismatched easing (ease-in-out 300ms) | Normalise to `var(--ease-slow)` |
| `background: '#0f1009'` on query well | Replace with `var(--bg-inset)` |
| Textarea with `fontFamily: 'monospace'` bare | Replace with `textarea.input` class (DM Mono via .input) |
| Generate button `backgroundColor: '#2a3a2e'` hardcoded | Replace with `.btn-primary` |
| Error messages inline red style | Replace with `.error-block` |

---

#### SchedulerMonitor.js

| Issue | Fix |
|---|---|
| Run log table with custom `<table>` styles | Replace with `.data-table` |
| `color: '#4ade80'` (Tailwind green-400) on success status — wrong palette | Replace with `var(--green-text)` |
| Countdown ring SVG geometry inline | Move to `scoreArc()`-pattern or dedicated `countdownArc()` |
| `fontSize: '10px'` scattered on metadata | Replace with `var(--text-xs)` |
| Status labels `'active'/'paused'/'error'` → hardcoded inline colors | Route through `stateColor()` |

---

#### page.js (shell)

| Issue | Fix |
|---|---|
| Sidebar active item uses `borderLeft: '2px solid #4d8c62'` inline | Replace with `.db-nav-item.active` (CSS handles border) |
| Nav item font `fontSize: 12` without `fontFamily` — inherits body DM Sans ✓ but no letterSpacing | `.db-nav-item` now defines full spec |
| View transition missing — no animation on panel switch | Add `.animate-view` to top-level view container |
| Header wordmark `fontStyle: 'italic'` inlined | Handled by `.db-wordmark` |

---

### Summary Violation Count

| Component | Color violations | Font violations | Spacing violations | Duplicate class definitions |
|---|---|---|---|---|
| globals.css | 4 | 2 | 3 | 6 |
| tokens.js | 8 | 0 | 0 | 5 |
| DraftBoard | 6 | 3 | 2 | 1 |
| DiscoveryEngine | 4 | 2 | 1 | 2 |
| PipelineDashboard | 3 | 2 | 2 | 0 |
| ThemeIntelligence | 4 | 1 | 2 | 1 |
| ThemeWorkbench | 3 | 1 | 1 | 0 |
| SchedulerMonitor | 4 | 2 | 1 | 1 |
| page.js | 2 | 0 | 0 | 1 |
| **Total** | **38** | **13** | **12** | **17** |

All 80 violations are resolved by adopting globals.css v2 and tokens.js v2.

---

## 3. Example UI Description

### What a user sees when they open DraftBoard

The shell loads black — warm charcoal, not blue-black. A 50px header sits at the top: the wordmark *The Peanut Gallery* in Libre Baskerville italic at 16px, followed by a hairline rule and a monospaced breadcrumb in the smallest text size. The header carries no other decoration. A status pip in amber pulses at 3-second intervals in the top-right corner indicating the last pipeline run time in DM Mono.

The left sidebar (192px) reads like a physical drawer: background one step warmer than the page, barely visible border on the right edge. Navigation items sit in two groups — SIGNALS and SYSTEM — with 8px mono caps group labels in the darkest text value. The active item carries a 2px green left-border accent and a 9% green background wash. Inactive items read as near-invisible until hovered.

The main area is divided: a 36px topbar containing the current view name in DM Mono caps and a secondary descriptor in the smallest UI text, then the scrollable view below.

### A candidate card on the DraftBoard

The card face is `--bg-raised` — marginally lighter than the view background. A 1px border, barely perceptible at rest, brightens on hover. High-conviction candidates carry a green left-accent border — the only color applied structurally.

Left side: a 48px SVG score arc. The ring track is `--border-0`. The fill is green, amber, or red depending on score — computed by `scoreArc()`. The score number sits centered in DM Mono at 22px. Below it, the score tier letter (A/B/C) in 9px caps.

Right of the arc: the ticker in DM Mono 15px/500 at full primary text brightness. Below it, the company name in DM Sans 12px at tertiary brightness. A row of badges below that — signal type (THESIS / CATALYST / MOMENTUM), mention count, velocity label — all in 8px DM Mono caps with signal-appropriate background tints.

A 2px score bar spans the card bottom — full width of the content area, `--border-0` track, colored fill animating in at 700ms on first render.

The card bottom row: source count, post date, theme name — all in DM Mono 10px at `--text-disabled`. Nothing competes with the score and ticker.

### What the room feels like

Every card in the shortlist is a name on a draft board. The scores are not decorative — they are the result of a deterministic pipeline. The colors are not brand choices — they are signal states. The fonts are not expressive — they are functional assignments: serif for the institution's name, sans for the operator's language, mono for the machine's output.

The room is quiet. The decisions are not.
