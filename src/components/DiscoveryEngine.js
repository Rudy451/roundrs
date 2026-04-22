"use client";
// components/DiscoveryEngine.jsx
// Paste Reddit text → Claude extracts and ranks tickers by signal quality.

import { useState } from "react";
import { C, S, SIGNAL_TYPE, VELOCITY, scoreColor, scoreBarClass } from "../lib/ui/tokens";

const SYSTEM_PROMPT = `You are an investment signal extraction and ranking engine for DraftBoard.

Extract stock/ETF tickers from Reddit text. Rank by ATTENTION WORTHINESS — signal quality over popularity.

Score 0–100: weight signal quality (substance, catalysts, thesis) highest. Penalize hype with no substance. Apply crowding penalty for oversaturated tickers.

OUTPUT: Return ONLY a valid JSON array. No markdown, no backticks.
[{
  "ticker": "NVDA",
  "score": 0-100,
  "mentions": number,
  "velocity": "low|medium|high",
  "signalType": "news|thesis|hype|meme|unknown",
  "confidence": 0.0-1.0,
  "reasoning": "brief, direct explanation",
  "risks": ["risk1"]
}]

Extract valid US tickers only (2–5 letters). Ignore: IT, ALL, FOR, ARE, NOW, BE, OR, GO, AM, PM, ON, AT, BY, AI (unless clearly a ticker).
Sort by score DESC. Max 15 results. Do not recommend buying or selling.`;

const SAMPLE = `r/wallstreetbets — 847 upvotes:
"SMCI is about to explode. AI server business growing 200% YoY, new partnership with NVDA for liquid cooling. Management guided $14-15B for FY25. Nobody is talking about this."

r/stocks — 312 upvotes:
"CELH deep dive — down 60% from highs. PEP distribution deal intact. International expansion UK, Australia, France all Q1. Management bought $2M in shares last month."

r/wallstreetbets — 2,341 upvotes:
"NVDA NVDA NVDA Jensen is a god. 1000 EOY easy."

r/investing — 156 upvotes:
"Macro thesis: Fed pivot incoming. TLT and IEF for the bond trade. ZROZ for maximum duration leverage. 10yr at 5% is unsustainable given debt service costs."

r/stocks — 567 upvotes:
"CCJ uranium thesis — 10-year supply deal signed with major utility. Nuclear renaissance is real. URA for diversified exposure."`;

async function callClaude(input) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Extract and rank signals:\n\n${input}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  const raw   = data.content.map(b => b.text || "").join("");
  const match = raw.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in response");
  return JSON.parse(match[0]);
}

function ScoreArc({ score }) {
  const color = scoreColor(score);
  const r = 19; const cx = 25; const cy = 25; const stroke = 3;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
      <svg width="50" height="50" style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.border1} strokeWidth={stroke} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${(score / 100) * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.16,1,0.3,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: C.fontData, fontSize: 11, color }}>{score}</span>
      </div>
    </div>
  );
}

function SignalCard({ result, rank, expanded, onToggle }) {
  const sm  = SIGNAL_TYPE[result.signalType] || SIGNAL_TYPE.unknown;
  const vel = VELOCITY[result.velocity]      || VELOCITY.low;
  return (
    <div
      className={`card card-p2 animate-card${expanded ? " card--green" : ""}`}
      style={{ cursor: "pointer", animationDelay: `${rank * 40}ms` }}
      onClick={onToggle}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ScoreArc score={result.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={S.ticker}>{result.ticker}</span>
            <span className={`badge ${sm.badgeClass}`}>{sm.label}</span>
            <span className={`t-mono ${vel.colorClass}`} style={{ marginLeft: "auto" }}>{vel.label}</span>
          </div>
          <p className="t-body" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: expanded ? "normal" : "nowrap" }}>
            {result.reasoning}
          </p>
        </div>
        <span style={{ color: C.textDisabled, fontSize: 14, flexShrink: 0, transition: "transform 0.18s", transform: expanded ? "rotate(180deg)" : "none" }}>⌄</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border0}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 12 }}>
            {[["Mentions", `${result.mentions}×`], ["Confidence", `${Math.round((result.confidence || 0) * 100)}%`]].map(([l, v]) => (
              <div key={l}>
                <div className="t-label" style={{ marginBottom: 3 }}>{l}</div>
                <div className="t-mono t-secondary">{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 10 }}>
            <div className="t-label" style={{ marginBottom: 5 }}>Confidence</div>
            <div className="bar-track">
              <div className={`bar-fill ${scoreBarClass(Math.round((result.confidence || 0) * 100))}`}
                style={{ width: `${Math.round((result.confidence || 0) * 100)}%` }} />
            </div>
          </div>
          {result.risks?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {result.risks.map((r, i) => <span key={i} className="badge badge-red">⚠ {r}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DiscoveryEngine() {
  const [input,   setInput]   = useState(SAMPLE);
  const [results, setResults] = useState([]);
  const [status,  setStatus]  = useState("idle");
  const [error,   setError]   = useState("");
  const [expanded, setExpanded] = useState(null);

  async function run() {
    if (!input.trim()) return;
    setStatus("loading"); setResults([]); setError(""); setExpanded(null);
    try {
      const data = await callClaude(input);
      setResults(data.sort((a, b) => b.score - a.score));
      setStatus("done");
    } catch (e) { setError(e.message); setStatus("error"); }
  }

  const top      = results[0];
  const avgScore = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : null;

  return (
    <div style={{ padding: "var(--sp-6)", maxWidth: 700 }}>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <div className="section-head">Input</div>
        <textarea className="input" rows={9} value={input} onChange={e => setInput(e.target.value)} placeholder="Paste Reddit posts…" />
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-6)" }}>
        <button className={`btn ${status !== "loading" && input.trim() ? "btn-primary" : ""}`} onClick={run} disabled={status === "loading" || !input.trim()}>
          {status === "loading" && <span className="spinner" />}
          {status === "loading" ? "Analyzing…" : "Run engine"}
        </button>
        <button className="btn" onClick={() => { setInput(SAMPLE); setResults([]); setStatus("idle"); }}>Sample</button>
      </div>

      {status === "error" && <div className="error-block" style={{ marginBottom: "var(--sp-4)" }}>{error}</div>}

      {results.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "var(--sp-3)", marginBottom: "var(--sp-5)" }}>
            {[["Candidates", results.length], ["Avg score", avgScore], ["Thesis", results.filter(r => r.signalType === "thesis").length]].map(([l, v]) => (
              <div key={l} className="card-inset" style={{ padding: "10px 14px" }}>
                <div className="t-value" style={{ fontSize: 20 }}>{v}</div>
                <div className="t-label" style={{ marginTop: 3 }}>{l}</div>
              </div>
            ))}
          </div>
          {top && (
            <div className="card-inset card--green" style={{ padding: "10px 14px", marginBottom: "var(--sp-4)", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span className="t-label t-green" style={{ paddingTop: 2, flexShrink: 0, whiteSpace: "nowrap" }}>Top signal</span>
              <span style={{ ...S.ticker, color: C.green }}>{top.ticker}</span>
              <span className="t-body" style={{ marginLeft: 4 }}>{top.reasoning}</span>
            </div>
          )}
          <div className="section-head">{results.length} signals — click to expand</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {results.map((r, i) => (
              <SignalCard key={r.ticker + i} result={r} rank={i + 1}
                expanded={expanded === r.ticker + i}
                onToggle={() => setExpanded(expanded === r.ticker + i ? null : r.ticker + i)} />
            ))}
          </div>
          <p className="t-label" style={{ marginTop: "var(--sp-5)", textAlign: "center" }}>Not financial advice</p>
        </>
      )}
      {status === "idle" && <div className="empty-state">Awaiting input</div>}
    </div>
  );
}
