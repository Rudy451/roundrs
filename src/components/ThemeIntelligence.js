"use client";
// components/ThemeIntelligence.jsx
// Score themes by investable attention value across five dimensions.
// AI scoring via Claude, heuristic fallback for known themes.

import { useState } from "react";
import { C, S, scoreColor } from "../lib/ui/tokens";

// ─── AI scoring ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Theme Intelligence Engine for DraftBoard.

Score themes (0–100) by INVESTABLE ATTENTION VALUE for Reddit signal discovery today (April 2026).

Dimensions:
1. Market impact (30%) — how directly does this drive tradeable securities
2. Catalyst frequency (25%) — earnings, macro releases, geopolitical triggers
3. Discussion velocity (20%) — is attention sustained, rising, or fading now
4. Ticker mappability (15%) — how cleanly does this map to specific securities
5. Crowding penalty (−10%) — oversaturation, retail pile-in, already priced in

Be decisive. Use the full 0–100 range. Reward emerging under-discussed themes. Penalize obvious crowded trades heavily.

OUTPUT: Return ONLY a valid JSON array. No markdown, no backticks, no preamble.
[{
  "theme": "AI",
  "score": 88,
  "dimensions": {
    "marketImpact": 95,
    "catalystFrequency": 85,
    "discussionVelocity": 82,
    "tickerMappability": 95,
    "crowdingPenalty": 28
  },
  "rationale": "one direct sentence explaining the score",
  "topTickers": ["NVDA","AMD","SMCI"],
  "crowded": false,
  "emerging": false
}]`;

async function aiScore(themes) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Score these themes (April 2026):\n\nThemes: ${themes.map(t => `"${t}"`).join(", ")}\n\nReturn the JSON array.` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  const raw   = data.content.map(b => b.text || "").join("");
  const match = raw.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in response");
  return JSON.parse(match[0]).map(e => ({ ...e, source: "ai" }));
}

// ─── Heuristic fallback ───────────────────────────────────────────────────────
// [marketImpact, catalystFreq, velocity, mappability, crowdingPenalty, tickers]

const H = {
  ai:               [95,85,88,95,22,["NVDA","AMD","SMCI","ARM","PLTR"]],
  semiconductor:    [90,80,75,92,15,["NVDA","AMD","ASML","MU","KLAC"]],
  "interest rates": [98,90,80,85,10,["TLT","IEF","ZROZ","XLF","JPM"]],
  rates:            [98,90,80,85,10,["TLT","IEF","ZROZ","XLF","JPM"]],
  inflation:        [92,85,72,78,12,["TIP","GLD","XLE","COST"]],
  oil:              [88,78,70,90,14,["CVX","XOM","COP","USO","GUSH"]],
  energy:           [85,75,68,88,12,["XLE","CVX","XOM","COP","SLB"]],
  uranium:          [78,60,72,88, 8,["CCJ","URA","URNM","NLR"]],
  crypto:           [82,80,85,85,28,["MSTR","COIN","IBIT","RIOT"]],
  bitcoin:          [80,78,82,88,26,["MSTR","IBIT","FBTC","CLSK"]],
  biotech:          [80,82,65,85,10,["XBI","IBB","MRNA","VRTX","REGN"]],
  healthcare:       [75,70,60,80, 8,["XLV","UNH","LLY","ISRG"]],
  "weight loss":    [82,75,78,90,18,["LLY","NVO","HIMS","ALT"]],
  glp1:             [82,75,78,90,18,["LLY","NVO","HIMS","ALT"]],
  banks:            [80,78,65,88,10,["JPM","BAC","GS","WFC","KRE"]],
  fintech:          [72,68,62,85,12,["SQ","PYPL","SOFI","HOOD"]],
  macro:            [88,72,68,72, 8,["SPY","TLT","GLD","VIX"]],
  recession:        [85,65,60,75,10,["SPY","TLT","GLD","XLP"]],
  china:            [78,68,62,85,14,["BABA","JD","PDD","FXI","KWEB"]],
  ev:               [75,72,68,90,20,["TSLA","RIVN","NIO","F","GM"]],
  solar:            [70,65,58,88,12,["FSLR","ENPH","SEDG","TAN"]],
  gold:             [72,62,60,88,14,["GLD","GDX","GDXJ","NEM"]],
  commodities:      [75,65,55,78,10,["GLD","USO","PDBC","COPX"]],
  copper:           [72,60,60,85, 8,["FCX","COPX","SCCO","TECK"]],
  housing:          [70,62,55,75, 8,["ITB","XHB","DHI","LEN"]],
  consumer:         [65,60,55,72, 8,["XLY","XLP","AMZN","WMT"]],
  software:         [80,75,68,85,12,["CRM","NOW","SNOW","PLTR","ADBE"]],
  cloud:            [82,78,70,85,14,["AMZN","MSFT","GOOG","SNOW","DDOG"]],
  cybersecurity:    [78,72,65,88,10,["CRWD","ZS","OKTA","PANW","NET"]],
  "emerging markets":[65,55,50,72, 8,["VWO","EEM","FXI","EWZ"]],
  reit:             [65,60,55,85, 8,["VNQ","O","AMT","VICI"]],
};

function heuristic(theme) {
  const key = theme.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "");
  const row = H[key];
  if (!row) {
    return {
      theme, score: 55,
      dimensions: { marketImpact: 55, catalystFrequency: 50, discussionVelocity: 50, tickerMappability: 45, crowdingPenalty: 5 },
      rationale: "Unknown theme — scored conservatively.", topTickers: [], crowded: false, emerging: false, source: "heuristic",
    };
  }
  const [mi, cf, dv, tm, cp, tickers] = row;
  const score = Math.round(mi * 0.30 + cf * 0.25 + dv * 0.20 + tm * 0.15 - cp * 0.10);
  return {
    theme, score,
    dimensions: { marketImpact: mi, catalystFrequency: cf, discussionVelocity: dv, tickerMappability: tm, crowdingPenalty: cp },
    rationale: `Impact ${mi}, catalysts ${cf}, velocity ${dv}, mappability ${tm}. Crowding penalty −${cp}.`,
    topTickers: tickers, crowded: cp >= 20, emerging: dv >= 75 && cp < 12, source: "heuristic",
  };
}

// ─── Dimension metadata ───────────────────────────────────────────────────────

const DIM_META = {
  marketImpact:       { label: "Market impact",    color: C.green },
  catalystFrequency:  { label: "Catalyst freq",    color: C.green },
  discussionVelocity: { label: "Disc. velocity",   color: C.amber },
  tickerMappability:  { label: "Ticker mapping",   color: C.amber },
  crowdingPenalty:    { label: "Crowding penalty", color: C.red   },
};

const SUGGESTIONS = [
  "AI", "oil", "uranium", "crypto", "interest rates", "biotech",
  "banks", "EV", "gold", "china", "inflation", "semiconductor",
  "housing", "copper", "fintech", "macro",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThemeTag({ theme, onRemove }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: C.bgElevated, border: `1px solid ${C.border1}`,
      borderRadius: 4, padding: "3px 9px",
    }}>
      <span style={{ ...S.ticker, fontSize: 13 }}>{theme}</span>
      <button
        onClick={() => onRemove(theme)}
        style={{ background: "none", border: "none", color: C.textDisabled, cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}
      >×</button>
    </div>
  );
}

function DimBar({ dimKey, value, animate, delay }) {
  const m = DIM_META[dimKey];
  if (!m) return null;
  const isPenalty = dimKey === "crowdingPenalty";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 28px", gap: 8, alignItems: "center" }}>
      <span className="t-label">{m.label}</span>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{
            width: animate ? `${value}%` : "0%",
            background: m.color,
            transition: `width 0.75s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
          }}
        />
      </div>
      <span className="t-mono" style={{ textAlign: "right", color: m.color }}>
        {isPenalty ? `−${value}` : value}
      </span>
    </div>
  );
}

function ThemeCard({ result, rank, expanded, onToggle, animateBars }) {
  const sc = scoreColor(result.score);
  return (
    <div
      className={`card card-p2 animate-card${expanded ? " card--amber" : ""}`}
      style={{ cursor: "pointer", animationDelay: `${rank * 50}ms` }}
      onClick={onToggle}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="t-label" style={{ width: 20, flexShrink: 0 }}>#{rank}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ ...S.ticker, fontSize: 15 }}>{result.theme}</span>
            {result.crowded  && <span className="badge badge-red">Crowded</span>}
            {result.emerging && <span className="badge badge-green">Emerging</span>}
            {result.source === "ai" && <span className="badge badge-neutral">AI</span>}
            <span className="t-mono" style={{ marginLeft: "auto", color: sc }}>{result.score}/100</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${result.score}%`, background: sc }} />
          </div>
        </div>
        <span style={{ color: C.textDisabled, fontSize: 14, flexShrink: 0, transition: "transform 0.18s", transform: expanded ? "rotate(180deg)" : "none" }}>⌄</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border0}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {Object.entries(result.dimensions || {}).map(([k, v], i) => (
              <DimBar key={k} dimKey={k} value={v} animate={animateBars} delay={i * 70} />
            ))}
          </div>
          <p className="t-body" style={{ marginBottom: 10 }}>{result.rationale}</p>
          {result.topTickers?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {result.topTickers.slice(0, 5).map(t => (
                <span key={t} className="badge badge-amber">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ThemeIntelligence() {
  const [themes,    setThemes]    = useState(["AI", "oil", "crypto", "housing", "uranium"]);
  const [inputVal,  setInputVal]  = useState("");
  const [results,   setResults]   = useState([]);
  const [status,    setStatus]    = useState("idle");
  const [useAI,     setUseAI]     = useState(true);
  const [minScore,  setMinScore]  = useState(50);
  const [error,     setError]     = useState("");
  const [expanded,  setExpanded]  = useState(null);
  const [animBars,  setAnimBars]  = useState(false);

  function addTheme(t) {
    const clean = t.trim();
    if (!clean || themes.map(x => x.toLowerCase()).includes(clean.toLowerCase())) return;
    setThemes(p => [...p, clean]);
    setInputVal("");
  }

  function removeTheme(t) { setThemes(p => p.filter(x => x !== t)); }

  function handleKey(e) {
    if ((e.key === "Enter" || e.key === ",") && inputVal.trim()) {
      e.preventDefault(); addTheme(inputVal);
    }
    if (e.key === "Backspace" && !inputVal && themes.length) {
      setThemes(p => p.slice(0, -1));
    }
  }

  async function score() {
    if (!themes.length) return;
    setStatus("loading"); setResults([]); setError(""); setExpanded(null); setAnimBars(false);
    try {
      let scored;
      if (useAI) {
        try   { scored = await aiScore(themes); }
        catch { scored = themes.map(heuristic); }
      } else {
        scored = themes.map(heuristic);
      }
      const covered = new Set(scored.map(s => s.theme.toLowerCase()));
      themes.forEach(t => { if (!covered.has(t.toLowerCase())) scored.push(heuristic(t)); });
      setResults(scored.filter(s => s.score >= minScore).sort((a, b) => b.score - a.score));
      setStatus("done");
      setTimeout(() => setAnimBars(true), 150);
    } catch (e) {
      setError(e.message); setStatus("error");
    }
  }

  const top = results[0];
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : null;

  return (
    <div style={{ padding: "var(--sp-6)", maxWidth: 700 }}>

      {/* Input box */}
      <div className="card-inset" style={{ padding: "var(--sp-3) var(--sp-4)", marginBottom: "var(--sp-3)" }}>
        <div className="t-label" style={{ marginBottom: "var(--sp-2)" }}>Themes — Enter to add</div>
        {themes.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
            {themes.map(t => <ThemeTag key={t} theme={t} onRemove={removeTheme} />)}
          </div>
        )}
        <input
          className="input"
          style={{ border: "none", background: "none", padding: "4px 0" }}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKey}
          placeholder={themes.length ? "Add another theme…" : "Type a theme e.g. uranium, banks, macro…"}
        />
      </div>

      {/* Suggestions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginBottom: "var(--sp-4)" }}>
        {SUGGESTIONS.map(s => {
          const active = themes.map(t => t.toLowerCase()).includes(s.toLowerCase());
          return (
            <button
              key={s}
              className="btn"
              style={{
                padding: "3px 9px", fontSize: 10,
                background:   active ? C.bgElevated : "transparent",
                borderColor:  active ? C.border2 : C.border0,
                color:        active ? C.textSecondary : C.textDisabled,
              }}
              onClick={() => active ? removeTheme(s) : addTheme(s)}
            >
              {active ? "✓ " : "+ "}{s}
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center", marginBottom: "var(--sp-6)", flexWrap: "wrap" }}>
        <button
          className={`btn ${status !== "loading" && themes.length ? "btn-primary" : ""}`}
          onClick={score}
          disabled={status === "loading" || !themes.length}
        >
          {status === "loading" && <span className="spinner" />}
          {status === "loading" ? "Scoring…" : `Score ${themes.length} theme${themes.length !== 1 ? "s" : ""}`}
        </button>

        <button
          className={`btn ${useAI ? "btn-amber" : ""}`}
          onClick={() => setUseAI(v => !v)}
        >
          {useAI ? "AI on" : "AI off"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginLeft: "auto" }}>
          <span className="t-label">Min</span>
          {[40, 50, 60, 70].map(v => (
            <button
              key={v}
              className={`btn ${minScore === v ? "btn-primary" : ""}`}
              style={{ padding: "3px 8px", fontSize: 9 }}
              onClick={() => setMinScore(v)}
            >{v}+</button>
          ))}
        </div>
      </div>

      {status === "error" && (
        <div className="error-block" style={{ marginBottom: "var(--sp-4)" }}>{error}</div>
      )}

      {results.length > 0 && (
        <>
          {/* Summary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
            {[
              ["Ranked",   results.length],
              ["Avg score", avg],
              ["Emerging", results.filter(r => r.emerging).length],
              ["Crowded",  results.filter(r => r.crowded).length],
            ].map(([label, val]) => (
              <div key={label} className="card-inset" style={{ padding: "10px 14px" }}>
                <div className="t-value" style={{ fontSize: 20 }}>{val}</div>
                <div className="t-label" style={{ marginTop: 3 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Top theme callout */}
          {top && (
            <div
              className="card-inset card--amber"
              style={{ padding: "10px 14px", marginBottom: "var(--sp-4)", display: "flex", gap: 10, alignItems: "flex-start" }}
            >
              <span className="t-label t-amber" style={{ flexShrink: 0, paddingTop: 2 }}>Top theme</span>
              <span style={{ ...S.ticker, color: C.amber }}>{top.theme}</span>
              <span className="t-body" style={{ marginLeft: 4 }}>
                {top.rationale?.slice(0, 120)}{top.rationale?.length > 120 ? "…" : ""}
              </span>
            </div>
          )}

          <div className="section-head">{results.length} themes above {minScore} — click to expand</div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {results.map((r, i) => (
              <ThemeCard
                key={r.theme}
                result={r}
                rank={i + 1}
                animateBars={animBars}
                expanded={expanded === r.theme}
                onToggle={() => setExpanded(expanded === r.theme ? null : r.theme)}
              />
            ))}
          </div>

          <p className="t-label" style={{ marginTop: "var(--sp-6)", textAlign: "center" }}>
            Not financial advice — pipeline routing signal only
          </p>
        </>
      )}

      {status === "idle" && <div className="empty-state">Add themes and press score</div>}
    </div>
  );
}
