"use client";
// components/ThemeWorkbench.jsx
// Convert investment themes into targeted Reddit search queries.
// AI expansion via Claude, static map fallback.

import { useState } from "react";
import { C, S } from "../lib/ui/tokens";

// ─── AI expansion ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial research query generator for DraftBoard.

Convert investment themes into high-signal Reddit search queries that surface investor discussion, catalysts, and bull/bear debates.

Rules:
- 4 queries per theme
- Financially specific — never a single generic word
- Layer in: financial context (stocks, earnings, ETF, thesis), catalysts (earnings, regulation, supply, demand, breakout), real tickers when relevant (NVDA for AI, CVX for oil)
- Include at least one bear/contrarian query per theme (bubble, headwinds, overcrowded, risk)
- Vary phrasing — no repeated key words across queries for the same theme

OUTPUT: Return ONLY a valid JSON array. No markdown, no backticks, no explanation.
[{
  "theme": "AI",
  "queries": [
    "AI stocks earnings catalyst semiconductor",
    "Nvidia AMD AI datacenter thesis undervalued",
    "AI infrastructure capex bubble overcrowded",
    "AI ETF emerging plays under-discussed"
  ],
  "rationale": "one sentence on expansion strategy"
}]`;

async function aiExpand(themes) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Expand these themes into 4 high-signal Reddit search queries each:\n\nThemes: ${themes.map(t => `"${t}"`).join(", ")}\n\nReturn the JSON array.`,
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  const raw   = data.content.map(b => b.text || "").join("");
  const match = raw.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in response");
  return JSON.parse(match[0]).map(e => ({ ...e, source: "ai" }));
}

// ─── Static map fallback ──────────────────────────────────────────────────────

const STATIC = {
  ai:               ["AI stocks earnings catalyst semiconductor", "Nvidia AMD AI datacenter thesis", "AI infrastructure capex bubble overcrowded", "AI ETF plays under-discussed"],
  semiconductor:    ["semiconductor stocks earnings TSMC ASML", "chip cycle thesis undervalued", "NVDA AMD supply demand", "semiconductor bubble bear case"],
  oil:              ["oil prices energy stocks CVX XOM thesis", "crude OPEC supply cut catalyst", "energy sector earnings beat", "oil demand destruction recession bear"],
  "interest rates": ["Fed rate cut stocks TLT thesis", "rate sensitive sectors beneficiaries", "duration trade ZROZ bond thesis", "higher for longer bear case equities"],
  rates:            ["Fed rate decision impact stocks", "rate cut beneficiaries growth thesis", "rate hike recession signal", "bonds vs equities positioning"],
  uranium:          ["uranium nuclear stocks CCJ URA thesis", "nuclear renaissance utility catalyst", "uranium supply deficit emerging", "nuclear overcrowded retail bubble"],
  crypto:           ["crypto stocks Bitcoin thesis MSTR COIN", "Bitcoin ETF IBIT inflows catalyst", "crypto regulatory crackdown risk", "altcoin cycle rotation thesis"],
  bitcoin:          ["Bitcoin halving price thesis stocks", "BTC ETF inflows IBIT FBTC", "Bitcoin mining stocks earnings", "Bitcoin bubble bear case regulation"],
  biotech:          ["biotech FDA approval catalyst XBI", "small cap biotech undervalued thesis", "biotech binary event risk", "biotech bubble sector crowded"],
  banks:            ["bank earnings net interest margin JPM BAC", "regional bank commercial real estate stress", "bank capital return thesis", "bank rate spread headwinds"],
  "weight loss":    ["GLP-1 obesity drug stocks LLY NVO", "weight loss drug competition pipeline", "Eli Lilly Novo Nordisk thesis earnings", "GLP-1 supply constraint catalyst"],
  china:            ["China stocks ADR BABA JD stimulus", "China economy recovery catalyst", "China tech regulation geopolitical risk", "China decoupling bear case"],
  ev:               ["EV stocks TSLA RIVN demand thesis", "electric vehicle competition price war", "EV battery supply chain catalyst", "EV demand slowdown bear case"],
  macro:            ["macro thesis rotation stocks bonds", "global slowdown market impact", "macro bull bear case debate", "macro hedge portfolio positioning"],
  inflation:        ["inflation hedge stocks commodities thesis", "CPI earnings stagflation impact", "inflation cooling disinflation catalyst", "inflation breakout bear case equities"],
  gold:             ["gold stocks GDX GLD hedge thesis", "gold miners earnings leverage", "gold inflation hedge catalyst", "gold bubble overcrowded bear"],
  copper:           ["copper stocks EV infrastructure demand FCX", "copper supply thesis", "copper recession demand destruction", "copper supercycle debate"],
  housing:          ["housing market stocks ITB XHB thesis", "home builder earnings DHI LEN", "housing affordability headwinds", "commercial real estate distress bear"],
  solar:            ["solar energy stocks FSLR ENPH IRA catalyst", "clean energy earnings thesis", "solar margin compression headwinds", "renewable subsidy cliff risk"],
  fintech:          ["fintech stocks PYPL SQ SOFI earnings", "payments growth thesis catalyst", "fintech regulation headwinds bear", "fintech bubble overcrowded"],
};

function staticExpand(theme) {
  const key     = theme.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "");
  const queries = STATIC[key] ?? [
    `${theme} stocks earnings thesis`,
    `${theme} investment catalyst outlook`,
    `${theme} bull bear case debate`,
    `${theme} sector undervalued plays`,
  ];
  return { theme, queries, rationale: "Expanded via static query map.", source: STATIC[key] ? "static" : "template" };
}

// ─── Component pieces ─────────────────────────────────────────────────────────

const SOURCE_COLOR = { ai: C.green, static: C.amber, template: C.slate };
const SOURCE_LABEL = { ai: "AI", static: "Static", template: "Template" };

const SUGGESTIONS = [
  "AI", "oil", "uranium", "crypto", "interest rates",
  "biotech", "banks", "EV", "gold", "china", "macro", "inflation",
];

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

function QueryRow({ query, index }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(query).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div
      onClick={copy}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 14px",
        borderBottom: `1px solid ${C.border0}`,
        cursor: "pointer",
        transition: "background var(--ease-fast)",
      }}
      onMouseEnter={e => e.currentTarget.style.background = C.bgElevated}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <span className="t-label" style={{ width: 14, flexShrink: 0 }}>{index + 1}</span>
      <span className="t-mono t-secondary" style={{ flex: 1, fontSize: 11 }}>{query}</span>
      <span className="t-label" style={{ flexShrink: 0, transition: "color 0.15s", color: copied ? C.green : C.textDisabled }}>
        {copied ? "✓" : "⎘"}
      </span>
    </div>
  );
}

function ExpansionCard({ expansion, animate, index }) {
  const srcColor = SOURCE_COLOR[expansion.source] || C.slate;
  const srcLabel = SOURCE_LABEL[expansion.source] || "?";

  return (
    <div className="card animate-card" style={{ animationDelay: `${index * 60}ms`, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px",
        borderBottom: `1px solid ${C.border0}`,
        background: C.bgSurface,
      }}>
        <span style={S.ticker}>{expansion.theme}</span>
        <span
          className="badge"
          style={{ background: `${srcColor}18`, color: srcColor, border: `1px solid ${srcColor}30` }}
        >{srcLabel}</span>
        <span className="t-label" style={{ marginLeft: "auto" }}>{expansion.queries.length} queries</span>
      </div>

      {/* Rationale */}
      {expansion.rationale && (
        <div style={{ padding: "6px 14px", borderBottom: `1px solid ${C.border0}` }}>
          <span className="t-label t-amber">Strategy — </span>
          <span className="t-body">{expansion.rationale}</span>
        </div>
      )}

      {/* Queries — click to copy */}
      <div>
        {expansion.queries.map((q, i) => (
          <QueryRow key={i} query={q} index={i} />
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ThemeWorkbench() {
  const [themes,     setThemes]     = useState(["AI", "oil", "crypto"]);
  const [inputVal,   setInputVal]   = useState("");
  const [expansions, setExpansions] = useState([]);
  const [status,     setStatus]     = useState("idle");
  const [useAI,      setUseAI]      = useState(true);
  const [error,      setError]      = useState("");
  const [animate,    setAnimate]    = useState(false);

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

  async function expand() {
    if (!themes.length) return;
    setStatus("loading"); setExpansions([]); setError(""); setAnimate(false);
    try {
      let results;
      if (useAI) {
        try   { results = await aiExpand(themes); }
        catch { results = themes.map(staticExpand); }
      } else {
        results = themes.map(staticExpand);
      }
      // Patch any missing themes
      const covered = new Set(results.map(r => r.theme.toLowerCase()));
      themes.forEach(t => { if (!covered.has(t.toLowerCase())) results.push(staticExpand(t)); });
      setExpansions(results);
      setStatus("done");
      setTimeout(() => setAnimate(true), 30);
    } catch (e) {
      setError(e.message); setStatus("error");
    }
  }

  // Total queries that will be sent to Reddit (cap: 5)
  const totalQueries = Math.min(expansions.reduce((s, e) => s + Math.min(e.queries.length, 2), 0), 5);
  const sourceBreakdown = expansions.reduce((m, e) => { m[e.source] = (m[e.source] || 0) + 1; return m; }, {});

  return (
    <div style={{ padding: "var(--sp-6)", maxWidth: 700 }}>

      {/* Theme input */}
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

      {/* Quick add */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginBottom: "var(--sp-4)" }}>
        {SUGGESTIONS.map(s => {
          const active = themes.map(t => t.toLowerCase()).includes(s.toLowerCase());
          return (
            <button
              key={s}
              className="btn"
              style={{
                padding: "3px 9px", fontSize: 10,
                background:  active ? C.bgElevated : "transparent",
                borderColor: active ? C.border2 : C.border0,
                color:       active ? C.textSecondary : C.textDisabled,
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
          onClick={expand}
          disabled={status === "loading" || !themes.length}
        >
          {status === "loading" && <span className="spinner" />}
          {status === "loading" ? "Expanding…" : `Expand ${themes.length} theme${themes.length !== 1 ? "s" : ""}`}
        </button>

        <button
          className={`btn ${useAI ? "btn-amber" : ""}`}
          onClick={() => setUseAI(v => !v)}
        >
          {useAI ? "AI on" : "AI off"}
        </button>

        {expansions.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginLeft: "auto" }}>
            {Object.entries(sourceBreakdown).map(([src, count]) => (
              <span key={src} className="t-mono" style={{ color: SOURCE_COLOR[src] || C.slate }}>
                {count} {SOURCE_LABEL[src] || src}
              </span>
            ))}
            <span className="t-label">→ {totalQueries} to Reddit</span>
          </div>
        )}
      </div>

      {status === "error" && (
        <div className="error-block" style={{ marginBottom: "var(--sp-4)" }}>{error}</div>
      )}

      {/* Results */}
      {expansions.length > 0 && (
        <>
          <div className="section-head">
            {expansions.length} themes expanded — click any query to copy
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {expansions.map((exp, i) => (
              <ExpansionCard key={exp.theme} expansion={exp} animate={animate} index={i} />
            ))}
          </div>

          {/* Pipeline call */}
          <div className="card-inset" style={{ padding: "var(--sp-3) var(--sp-4)", marginTop: "var(--sp-4)" }}>
            <div className="t-label" style={{ marginBottom: "var(--sp-2)" }}>Pipeline integration</div>
            <code className="t-mono t-tertiary" style={{ fontSize: 11, lineHeight: 1.8, display: "block" }}>
              {`await runPipeline({ themes: [${themes.map(t => `"${t}"`).join(", ")}] })`}
            </code>
          </div>
        </>
      )}

      {status === "idle" && <div className="empty-state">Add themes and press expand</div>}
    </div>
  );
}
