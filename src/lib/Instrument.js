export function selectInstrument({ conviction, clarity, timeHorizon }) {
  if (conviction >= 75 && timeHorizon === "short") return "LEVERAGED_ETF";
  if (conviction >= 80 && clarity === "high")      return "STOCK";
  if (conviction >= 60)                            return "ETF";
  return "ETF";
}

// Allocation cap per instrument type — called after getPositionSize
export function capByInstrument(base, instrument) {
  if (instrument === "LEVERAGED_ETF") return Math.min(base, 3);
  if (instrument === "ETF")           return Math.min(base + 1, 10);
  return base; // STOCK unchanged
}

export const INSTRUMENT_STYLES = {
  STOCK:         { label: "Stock",   color: "text-sky-400",    border: "border-sky-500/30",    bg: "bg-sky-400/5"    },
  ETF:           { label: "ETF",     color: "text-violet-400", border: "border-violet-500/30", bg: "bg-violet-400/5" },
  LEVERAGED_ETF: { label: "Lev ETF", color: "text-amber-400",  border: "border-amber-500/30",  bg: "bg-amber-400/5"  },
};
