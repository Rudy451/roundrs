// src/lib/tokens.js
//
// Design system tokens for The Peanut Gallery.
//
// Single source of truth for all JS-side styling decisions.
// CSS custom properties (globals.css) are the source of truth for
// structural layout. These tokens are for inline styles, SVG primitives,
// dynamic color logic, and computed values that CSS cannot express.
//
// Rules:
//   - Components import C, T, S from here. Never raw hex in component files.
//   - CSS classes (card, badge, btn, etc.) are preferred over inline styles
//     for static structure. Tokens are for DYNAMIC values only.
//   - scoreColor(), signalColor(), stateColor() are the only color
//     decision functions. No color logic lives in components.

// ─── Colors ───────────────────────────────────────────────────────────────────

export const C = {

  // Backgrounds — warm charcoal stack
  bgBase:     '#0d0e0b',
  bgSurface:  '#111310',
  bgRaised:   '#161810',
  bgElevated: '#1c1e15',
  bgInset:    '#0a0b08',

  // Borders — rgba steps
  border0: 'rgba(255,253,240,0.038)',
  border1: 'rgba(255,253,240,0.070)',
  border2: 'rgba(255,253,240,0.110)',
  border3: 'rgba(255,253,240,0.170)',

  // Text — warm off-white stack
  textPrimary:   '#e6e3d8',
  textSecondary: '#aeaba3',
  textTertiary:  '#6c6960',
  textDisabled:  '#3a3832',

  // Signal: green — conviction, confirmed, positive
  green:       '#4a8a5f',
  greenDim:    'rgba(74,138,95,0.09)',
  greenBorder: 'rgba(74,138,95,0.20)',
  greenGlow:   'rgba(74,138,95,0.14)',
  greenText:   '#5fa876',

  // Signal: amber — attention, caution, pending, running
  amber:       '#9b7a32',
  amberDim:    'rgba(155,122,50,0.09)',
  amberBorder: 'rgba(155,122,50,0.20)',
  amberGlow:   'rgba(155,122,50,0.14)',
  amberText:   '#b8953f',

  // Signal: red — risk, error, penalty, negative
  red:         '#8a3e3e',
  redDim:      'rgba(138,62,62,0.09)',
  redBorder:   'rgba(138,62,62,0.20)',
  redText:     '#a85050',

  // Signal: slate — neutral data, low-velocity, secondary metadata
  slate:       '#4c5e6c',
  slateDim:    'rgba(76,94,108,0.09)',
  slateBorder: 'rgba(76,94,108,0.18)',
};

// ─── Typography ───────────────────────────────────────────────────────────────

export const T = {
  display: "'Libre Baskerville', Georgia, serif",   // wordmark only
  ui:      "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
  data:    "'DM Mono', 'Courier New', monospace",

  // Size scale — matches CSS --text-* vars
  xs:   '10px',
  sm:   '12px',
  base: '13px',
  md:   '15px',
  lg:   '18px',
  xl:   '22px',
};

// ─── Spacing ──────────────────────────────────────────────────────────────────
// 4px base unit. Used for inline style gaps where CSS class is insufficient.

export const SP = {
  1:  4,
  2:  8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
};

// ─── Radii ────────────────────────────────────────────────────────────────────

export const R = {
  xs: '2px',
  sm: '4px',
  md: '5px',
  lg: '7px',
};

// ─── Score color ──────────────────────────────────────────────────────────────
//
// Maps a numeric score → { stroke, text, dim, border }
// Used by ScoreArc (SVG ring), score badges, and bar fills.
//
// Thresholds:
//   ≥ 70  green  — high conviction
//   ≥ 50  amber  — watchlist candidate
//   < 50  red    — marginal / watch only
//
// No component should reimplement this logic.

export function scoreColor(score) {
  if (score >= 70) return {
    stroke: C.green,
    text:   C.greenText,
    dim:    C.greenDim,
    border: C.greenBorder,
    glow:   C.greenGlow,
    css:    'green',
  };
  if (score >= 50) return {
    stroke: C.amber,
    text:   C.amberText,
    dim:    C.amberDim,
    border: C.amberBorder,
    glow:   C.amberGlow,
    css:    'amber',
  };
  return {
    stroke: C.red,
    text:   C.redText,
    dim:    C.redDim,
    border: C.redBorder,
    glow:   null,
    css:    'red',
  };
}

// ─── Signal type color ────────────────────────────────────────────────────────
//
// Maps a signal classification string → color set.
// Used by signal type badges in DraftBoard and DiscoveryEngine.
//
// Canonical signal types (from analyzeSignals.js):
//   'thesis'    — structured investment thesis
//   'catalyst'  — near-term event / catalyst
//   'momentum'  — price/volume momentum mention
//   'risk'      — risk flag or bear case
//   'noise'     — low-quality / unclassified
//
// Unknown types fall back to slate (neutral).

export function signalColor(signalType) {
  switch ((signalType ?? '').toLowerCase()) {
    case 'thesis':   return { text: C.greenText,  dim: C.greenDim,  border: C.greenBorder,  css: 'green'   };
    case 'catalyst': return { text: C.amberText,  dim: C.amberDim,  border: C.amberBorder,  css: 'amber'   };
    case 'momentum': return { text: C.amberText,  dim: C.amberDim,  border: C.amberBorder,  css: 'amber'   };
    case 'risk':     return { text: C.redText,    dim: C.redDim,    border: C.redBorder,    css: 'red'     };
    case 'noise':    return { text: C.textDisabled, dim: 'transparent', border: C.border0,  css: 'neutral' };
    default:         return { text: C.slate,      dim: C.slateDim,  border: C.slateBorder,  css: 'neutral' };
  }
}

// ─── Pipeline state color ─────────────────────────────────────────────────────
//
// Maps pipeline run / stage state → color set.
// Used by PipelineDashboard stage rows, SchedulerMonitor run log.
//
// Canonical states: 'idle' | 'running' | 'complete' | 'error' | 'partial'

export function stateColor(state) {
  switch ((state ?? '').toLowerCase()) {
    case 'complete': return { pip: C.green,       text: C.greenText, css: 'green'  };
    case 'running':  return { pip: C.amber,       text: C.amberText, css: 'amber'  };
    case 'error':    return { pip: C.red,         text: C.redText,   css: 'red'    };
    case 'partial':  return { pip: C.amber,       text: C.amberText, css: 'amber'  };
    case 'idle':
    default:         return { pip: C.textDisabled, text: C.textDisabled, css: 'neutral' };
  }
}

// ─── Score arc geometry ───────────────────────────────────────────────────────
//
// Computes SVG arc parameters for the score ring used in candidate cards.
// Returns everything the <svg> element needs — no math in components.
//
// @param {number} score   — 0–100
// @param {number} size    — outer diameter in px (default 48)
// @param {number} stroke  — stroke width in px (default 3)
//
// Usage:
//   const arc = scoreArc(signal.finalScore);
//   <svg width={arc.size} height={arc.size} viewBox={arc.viewBox}>
//     <circle cx={arc.cx} cy={arc.cy} r={arc.r}
//       fill="none" stroke={C.border0}
//       strokeWidth={arc.stroke} />
//     <circle cx={arc.cx} cy={arc.cy} r={arc.r}
//       fill="none" stroke={arc.color.stroke}
//       strokeWidth={arc.stroke}
//       strokeDasharray={arc.dashArray}
//       strokeDashoffset={arc.dashOffset}
//       strokeLinecap="round"
//       transform={arc.transform} />
//   </svg>

export function scoreArc(score, size = 48, strokeWidth = 3) {
  const s      = Math.max(0, Math.min(100, score ?? 0));
  const cx     = size / 2;
  const cy     = size / 2;
  const r      = (size - strokeWidth * 2) / 2;
  const circ   = 2 * Math.PI * r;
  const pct    = s / 100;
  const color  = scoreColor(s);

  return {
    size,
    viewBox:     `0 0 ${size} ${size}`,
    cx, cy, r,
    stroke:      strokeWidth,
    dashArray:   `${circ} ${circ}`,
    dashOffset:  circ * (1 - pct),
    transform:   `rotate(-90 ${cx} ${cy})`,
    color,
    score:       s,
  };
}

// ─── Velocity label ───────────────────────────────────────────────────────────
//
// Maps a velocity score → human label + color.
// Used in candidate card metadata rows.

export function velocityLabel(velocityScore) {
  if (velocityScore >= 75) return { label: 'Surging',  color: C.greenText  };
  if (velocityScore >= 50) return { label: 'Rising',   color: C.amberText  };
  if (velocityScore >= 25) return { label: 'Steady',   color: C.textTertiary };
  return                          { label: 'Low',      color: C.textDisabled };
}

// ─── Score tier label ─────────────────────────────────────────────────────────
//
// Maps a final score → short tier label used in compact list views.

export function scoreTier(score) {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

// ─── Shorthand export ─────────────────────────────────────────────────────────
// Named re-exports for destructured imports:
//   import { C, T, SP, R, scoreColor, signalColor, stateColor, scoreArc } from "@/lib/tokens";

export default { C, T, SP, R, scoreColor, signalColor, stateColor, scoreArc, velocityLabel, scoreTier };
