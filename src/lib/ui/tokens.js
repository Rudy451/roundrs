// /lib/ui/tokens.js
//
// JS mirror of the CSS design tokens in globals.css.
// ALL UI components import from here.
// No component ever defines its own color, font, or shadow.
//
// Rule: if you are writing a hex code or rgba() inside a component file, stop.
// Add it here instead.

export const C = {
  // Backgrounds
  bgBase:     "#0e0f0d",
  bgSurface:  "#131410",
  bgRaised:   "#18190f",
  bgElevated: "#1e2017",
  bgInset:    "#0b0c09",

  // Borders
  border0: "rgba(255,253,245,0.042)",
  border1: "rgba(255,253,245,0.076)",
  border2: "rgba(255,253,245,0.12)",
  border3: "rgba(255,253,245,0.18)",

  // Text
  textPrimary:   "#e8e5dc",
  textSecondary: "#b0ada5",
  textTertiary:  "#6e6b63",
  textDisabled:  "#3d3b35",

  // Signal accents
  green:       "#4d8c62",
  greenDim:    "rgba(77,140,98,0.10)",
  greenBorder: "rgba(77,140,98,0.22)",
  greenGlow:   "rgba(77,140,98,0.18)",

  amber:       "#9e7c35",
  amberDim:    "rgba(158,124,53,0.10)",
  amberBorder: "rgba(158,124,53,0.22)",
  amberGlow:   "rgba(158,124,53,0.18)",

  red:         "#8c4040",
  redDim:      "rgba(140,64,64,0.10)",
  redBorder:   "rgba(140,64,64,0.22)",

  slate:       "#4e606e",

  // Fonts (match CSS variables)
  fontDisplay: "'Libre Baskerville', Georgia, serif",
  fontUi:      "'DM Sans', 'Helvetica Neue', sans-serif",
  fontData:    "'DM Mono', 'Courier New', monospace",

  // Shadows
  shadowCard:  "0 1px 4px rgba(0,0,0,0.55), 0 2px 12px rgba(0,0,0,0.35)",
  shadowHover: "0 2px 8px rgba(0,0,0,0.7), 0 4px 16px rgba(0,0,0,0.45)",
};

// ─── Semantic helpers ─────────────────────────────────────────────────────────

/** Map 0–100 score to signal color */
export function scoreColor(score) {
  if (score >= 70) return C.green;
  if (score >= 50) return C.amber;
  return C.red;
}

/** Map 0–100 score to CSS bar class */
export function scoreBarClass(score) {
  if (score >= 70) return "bar-green";
  if (score >= 50) return "bar-amber";
  return "bar-red";
}

/** Signal type metadata */
export const SIGNAL_TYPE = {
  thesis:  { label: "Thesis",  badgeClass: "badge-green"   },
  news:    { label: "News",    badgeClass: "badge-amber"   },
  hype:    { label: "Hype",    badgeClass: "badge-neutral" },
  meme:    { label: "Meme",    badgeClass: "badge-red"     },
  unknown: { label: "Signal",  badgeClass: "badge-neutral" },
};

/** Velocity metadata */
export const VELOCITY = {
  high:   { label: "Rising", colorClass: "t-green" },
  medium: { label: "Steady", colorClass: "t-amber" },
  low:    { label: "Fading", colorClass: "t-disabled" },
};

// ─── Inline style objects (for SVG and dynamic values) ────────────────────────
// Use CSS classes wherever possible. Use these only when className isn't enough.

export const S = {
  card: {
    background:   C.bgRaised,
    border:       `1px solid ${C.border1}`,
    borderRadius: "6px",
    boxShadow:    C.shadowCard,
  },
  monoLabel: {
    fontFamily:    C.fontData,
    fontSize:      "9px",
    letterSpacing: "0.13em",
    textTransform: "uppercase",
    color:         C.textDisabled,
  },
  ticker: {
    fontFamily:    C.fontData,
    fontSize:      "16px",
    fontWeight:    500,
    letterSpacing: "0.05em",
    color:         C.textPrimary,
  },
  spinner: (color = C.amber) => ({
    width:          "10px",
    height:         "10px",
    border:         `1.5px solid ${C.border1}`,
    borderTopColor: color,
    borderRadius:   "50%",
    animation:      "spin 0.75s linear infinite",
    display:        "inline-block",
    flexShrink:     0,
  }),
  pip: (color, live = false) => ({
    width:        "5px",
    height:       "5px",
    borderRadius: "50%",
    background:   color,
    flexShrink:   0,
    animation:    live ? "livePip 3s ease infinite" : "none",
  }),
};
