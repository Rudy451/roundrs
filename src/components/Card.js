export default function Card({ trend, selected = false, notes = {}, conviction, positionSize, returnPct, instrument }) {
  const getTierConfig = (tier) => {
    switch (tier) {
      case "S":
        return {
          label: "S",
          color: "text-yellow-300",
          glow: "shadow-[0_0_18px_3px_rgba(250,204,21,0.35)] border-yellow-400/40",
          badge: "bg-yellow-400/10 border border-yellow-400/40 text-yellow-300",
          bar: "bg-yellow-400",
        };
      case "A":
        return {
          label: "A",
          color: "text-emerald-400",
          glow: "shadow-[0_0_14px_2px_rgba(52,211,153,0.2)] border-emerald-500/30",
          badge: "bg-emerald-400/10 border border-emerald-500/30 text-emerald-400",
          bar: "bg-emerald-400",
        };
      case "B":
        return {
          label: "B",
          color: "text-sky-400",
          glow: "shadow-[0_0_14px_2px_rgba(56,189,248,0.2)] border-sky-500/30",
          badge: "bg-sky-400/10 border border-sky-500/30 text-sky-400",
          bar: "bg-sky-400",
        };
      default:
        return {
          label: tier ?? "—",
          color: "text-zinc-400",
          glow: "shadow-[0_0_10px_1px_rgba(113,113,122,0.15)] border-zinc-600/30",
          badge: "bg-zinc-700/40 border border-zinc-600/30 text-zinc-400",
          bar: "bg-zinc-500",
        };
    }
  };

  const tier = getTierConfig(trend.tier);

  const selectedGlow = selected
    ? "shadow-[0_0_22px_4px_rgba(96,165,250,0.45)] border-blue-400/50"
    : "";

  // Icon signal rows: valuation, momentum, sentiment, risk, catalyst
  const signals = [
    {
      key: "valuation",
      label: "Val",
      // Scale icon — price tag
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A1 1 0 012 10V4a2 2 0 012-2h6a1 1 0 01.707.293l7 7zM6 6a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      key: "momentum",
      label: "Mom",
      // Trending up arrow
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      key: "sentiment",
      label: "Sent",
      // Chat bubble / pulse
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      key: "risk",
      label: "Risk",
      // Shield / warning
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      key: "catalyst",
      label: "Cat",
      // Lightning bolt
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
  ];

  // Score as a 0–100 normalised width
  const scorePercent = Math.min(100, Math.max(0, (trend.score ?? 0) * 10));
  const hasNotes = notes[trend.ticker] && notes[trend.ticker].trim().length > 0;

  const getConvictionColor = (s) => {
    if (s >= 80) return "text-emerald-400";
    if (s >= 60) return "text-amber-400";
    return "text-red-400";
  };

  return (
    <div
      className={`
        relative flex flex-col justify-between
        bg-[#0d0d0f] border rounded-2xl
        w-52 h-72 p-4 cursor-pointer
        transition-all duration-300 ease-out
        hover:scale-[1.03] hover:brightness-110
        ${selectedGlow || tier.glow}
      `}
    >
      {/* Subtle inner vignette */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.03] to-transparent" />

      {/* Notes indicator */}
      {hasNotes && (
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-400/80" />
      )}

      {/* ── TOP ROW: ticker + tier badge + instrument ── */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-mono tracking-widest text-zinc-500 uppercase">
            {trend.industry}
          </p>
          <h2 className="text-xl font-black tracking-tight text-zinc-100 leading-tight">
            {trend.ticker}
          </h2>
        </div>
        <div className="flex flex-col items-end gap-1 mt-0.5">
          <span className={`px-2 py-0.5 rounded-md text-xs font-bold tracking-wider ${tier.badge}`}>
            {tier.label}
          </span>
          {instrument && (() => {
            const STYLES = {
              STOCK:         "text-sky-400 border-sky-500/30 bg-sky-400/10",
              ETF:           "text-violet-400 border-violet-500/30 bg-violet-400/10",
              LEVERAGED_ETF: "text-amber-400 border-amber-500/30 bg-amber-400/10",
            };
            const LABELS = { STOCK: "Stock", ETF: "ETF", LEVERAGED_ETF: "Lev ETF" };
            return (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border font-mono ${STYLES[instrument] ?? ""}`}>
                {LABELS[instrument] ?? instrument}
              </span>
            );
          })()}
        </div>
      </div>

      {/* ── MIDDLE: price stack ── */}
      <div className="space-y-1 mt-1">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Price</span>
          <span className="text-base font-semibold text-zinc-100 tabular-nums">
            ${trend.price}
          </span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Target</span>
          <span className="text-sm text-zinc-400 tabular-nums">${trend.targetEntry}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Size</span>
          <span className="text-sm text-zinc-400 tabular-nums">${trend.positionSize}</span>
        </div>
      </div>

      {/* ── SCORE BAR ── */}
      <div className="mt-2 space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Score</span>
          <span className={`text-xs font-bold tabular-nums ${tier.color}`}>
            {trend.score}
          </span>
        </div>
        <div className="h-[3px] w-full bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${tier.bar}`}
            style={{ width: `${scorePercent}%` }}
          />
        </div>
      </div>

      {/* ── ATTENTION ROW (only when signals present) ── */}
      {(trend.signals?.attention != null) && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] font-mono text-zinc-700 uppercase tracking-widest">Attn</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-sky-400 tabular-nums">
              {trend.signals.attention}
            </span>
            <span className={`text-[10px] font-mono ${trend.signals.velocity > 0 ? "text-emerald-400" : "text-red-400"}`}>
              {trend.signals.velocity > 0 ? "↑" : "↓"}
            </span>
            {trend.signals.crowding > 80 && (
              <span className="text-[9px] font-mono text-red-400 border border-red-500/30 bg-red-400/5 px-1 rounded">
                crowded
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── BOTTOM ROW: signal icons + conviction + position size ── */}
      <div className="mt-3 flex justify-between items-center pt-2 border-t border-zinc-800/60">
        {signals.map((sig) => (
          <div
            key={sig.key}
            title={sig.label}
            className="flex flex-col items-center gap-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            {sig.icon}
          </div>
        ))}
        <div className="flex items-center gap-2">
          {returnPct !== null && returnPct !== undefined && (
            <span className={`text-[10px] font-mono font-semibold tabular-nums ${returnPct > 0 ? "text-emerald-400" : returnPct < 0 ? "text-red-400" : "text-zinc-500"}`}>
              {returnPct > 0 ? "↑" : returnPct < 0 ? "↓" : "·"}{Math.abs(returnPct).toFixed(1)}%
            </span>
          )}
          {conviction != null && (
            <span className={`text-[10px] font-mono font-semibold tabular-nums ${getConvictionColor(conviction)}`}>
              {conviction}
            </span>
          )}
          {positionSize != null && positionSize > 0 && (
            <span className="text-[10px] font-mono font-semibold tabular-nums text-sky-400">
              {positionSize}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
