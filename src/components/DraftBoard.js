"use client";
// components/DraftBoard.jsx
//
// Decision surface: scored → analyzed → shortlisted → filtered.
//
// Filtering is entirely client-side and non-destructive.
// Scores never change. Rankings re-number within the filtered view.
// "No filters active" always shows the full shortlist in its original order.

import { useState, useEffect, useCallback } from "react";
import { C, S, scoreColor }                 from "../lib/ui/tokens";
import { useFilters }                        from "../lib/ui/useFilters";

const REFRESH_MS = 5 * 60 * 1000;

// ─── Metadata maps ────────────────────────────────────────────────────────────

const SIGNAL_TYPE_META = {
  thesis:  { label: "Thesis",  badgeClass: "badge-green",   description: "Reasoned investment argument" },
  news:    { label: "News",    badgeClass: "badge-amber",   description: "Catalyst-driven attention"    },
  mixed:   { label: "Mixed",   badgeClass: "badge-neutral", description: "Split thesis and hype"        },
  hype:    { label: "Hype",    badgeClass: "badge-neutral", description: "Sentiment without evidence"   },
  unknown: { label: "Signal",  badgeClass: "badge-neutral", description: "Insufficient post data"       },
};

const CONFIDENCE_META = {
  high:   { label: "High confidence",   dotColor: C.green },
  medium: { label: "Medium confidence", dotColor: C.amber },
  low:    { label: "Low confidence",    dotColor: C.slate },
};

const VELOCITY_META = {
  high:   { label: "Rising", color: C.green },
  medium: { label: "Steady", color: C.amber },
  low:    { label: "Fading", color: C.slate },
};

const WEAK_TYPES = new Set(["hype", "unknown"]);

// Score thresholds for the filter control
const SCORE_THRESHOLDS = [0, 40, 50, 60, 70];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreArc({ score, size = 52 }) {
  const color = scoreColor(score);
  const r     = (size - 5) / 2;
  const cx    = size / 2, cy = size / 2;
  const circ  = 2 * Math.PI * r;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.border1} strokeWidth="3.5" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${(score / 100) * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.16,1,0.3,1)" }} />
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontFamily:C.fontData, fontSize:12, fontWeight:500, color, letterSpacing:"-0.02em" }}>
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

function ScoreBreakdown({ breakdown }) {
  if (!breakdown) return null;
  const rows = [
    ["Base",          breakdown.baseScore],
    ["Concentration", breakdown.concentrationScore],
    ["Consistency",   breakdown.consistencyScore],
    ["Quality",       breakdown.qualityScore],
    ["Penalty",       breakdown.penaltyAdjustment],
    ["Filter adj.",   breakdown.filterAdjustment],
  ].filter(([, v]) => v != null && v !== 0);

  return (
    <div style={{ marginTop:"var(--sp-3)", paddingTop:"var(--sp-3)", borderTop:`1px solid ${C.border0}` }}>
      <div className="t-label" style={{ marginBottom:"var(--sp-2)" }}>Score breakdown</div>
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {rows.map(([label, value]) => {
          const neg   = value < 0;
          const color = neg ? C.red : C.textTertiary;
          return (
            <div key={label} style={{ display:"grid", gridTemplateColumns:"100px 1fr 28px", alignItems:"center", gap:8 }}>
              <span className="t-label">{label}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width:`${Math.abs(value)}%`, background: neg ? C.red : C.slate }} />
              </div>
              <span style={{ fontFamily:C.fontData, fontSize:10, color, textAlign:"right" }}>
                {neg ? value : `+${value}`}
              </span>
            </div>
          );
        })}
        <div style={{ display:"flex", justifyContent:"space-between", paddingTop:"var(--sp-1)", borderTop:`1px solid ${C.border0}` }}>
          <span className="t-label">Adjusted</span>
          <span style={{ fontFamily:C.fontData, fontSize:11, color:scoreColor(breakdown.adjustedScore), fontWeight:500 }}>
            {breakdown.adjustedScore}
          </span>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({ candidate, rank, isTop }) {
  const [expanded, setExpanded] = useState(false);
  const { ticker, adjustedScore, signalType, confidence, narrativeSummary,
          keyCatalyst, keyRisk, mentions, velocity, scoreBreakdown, appliedRules } = candidate;

  const sm   = SIGNAL_TYPE_META[signalType] ?? SIGNAL_TYPE_META.unknown;
  const cm   = CONFIDENCE_META[confidence]  ?? CONFIDENCE_META.low;
  const vm   = VELOCITY_META[velocity]      ?? VELOCITY_META.low;
  const weak = WEAK_TYPES.has(signalType);

  return (
    <div
      className={`card animate-card${isTop ? " card--green" : ""}`}
      style={{ padding:"var(--sp-3) var(--sp-4)", opacity: weak ? 0.72 : 1, animationDelay:`${rank * 45}ms`, cursor:"pointer" }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Row 1: identity */}
      <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-3)", marginBottom:"var(--sp-3)" }}>
        <span className="t-label" style={{ width:18, flexShrink:0 }}>#{rank}</span>
        <ScoreArc score={adjustedScore} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", marginBottom:5, flexWrap:"wrap" }}>
            <span style={S.ticker}>{ticker}</span>
            <span className={`badge ${sm.badgeClass}`}>{sm.label}</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div className="pip" style={{ background:cm.dotColor }} />
            <span className="t-label">{cm.label}</span>
            <span className="divider-v" style={{ height:10 }} />
            <span className="t-label" style={{ color:vm.color }}>{vm.label}</span>
          </div>
        </div>
        <span style={{ color:C.textDisabled, fontSize:14, flexShrink:0, transition:"transform 0.18s", transform: expanded ? "rotate(180deg)" : "none" }}>⌄</span>
      </div>

      {/* Row 2: narrative */}
      {narrativeSummary && (
        <p className="t-body" style={{ marginBottom: keyCatalyst ? "var(--sp-2)" : 0 }}>
          {narrativeSummary}
        </p>
      )}

      {/* Row 3: catalyst */}
      {keyCatalyst && (
        <div style={{ display:"flex", gap:"var(--sp-2)", alignItems:"flex-start", marginTop:"var(--sp-2)" }}>
          <span className="t-label" style={{ color:C.amber, paddingTop:1, flexShrink:0, whiteSpace:"nowrap" }}>Catalyst</span>
          <span className="t-body" style={{ color:C.textSecondary }}>{keyCatalyst}</span>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop:"var(--sp-3)", paddingTop:"var(--sp-3)", borderTop:`1px solid ${C.border0}` }}>
          {keyRisk && (
            <div style={{ display:"flex", gap:"var(--sp-2)", alignItems:"flex-start", marginBottom:"var(--sp-3)" }}>
              <span className="t-label" style={{ color:C.red, paddingTop:1, flexShrink:0, whiteSpace:"nowrap" }}>Risk</span>
              <span className="t-body">{keyRisk}</span>
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"var(--sp-3)", marginBottom:"var(--sp-3)" }}>
            <div>
              <div className="t-label" style={{ marginBottom:3 }}>Mentions</div>
              <div style={{ fontFamily:C.fontData, fontSize:15, color:C.textPrimary }}>{mentions}</div>
            </div>
            <div>
              <div className="t-label" style={{ marginBottom:3 }}>Signal type</div>
              <div style={{ fontFamily:C.fontData, fontSize:11, color:C.textSecondary }}>{sm.description}</div>
            </div>
          </div>
          <ScoreBreakdown breakdown={scoreBreakdown} />
          {appliedRules?.length > 0 && (
            <div style={{ marginTop:"var(--sp-3)" }}>
              <div className="t-label" style={{ marginBottom:"var(--sp-2)" }}>Filter adjustments</div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {appliedRules.map((rule, i) => (
                  <span key={i} className="t-body" style={{ color:C.textDisabled, fontSize:10, fontFamily:C.fontData }}>{rule}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({ filters, options, toggleSignalType, setFilter, resetFilters, activeCount, resultCount, totalCount }) {
  const hasTypes  = options.signalTypes.length > 1;
  const hasThemes = options.themes.length > 1;

  return (
    <div style={{
      padding: "var(--sp-3) var(--sp-4)",
      marginBottom: "var(--sp-4)",
      borderTop:    `1px solid ${C.border0}`,
      borderBottom: `1px solid ${C.border0}`,
    }}>

      {/* Filter row */}
      <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"var(--sp-2)" }}>

        {/* Signal type toggles */}
        {hasTypes && options.signalTypes.map(type => {
          const active = filters.signalTypes.includes(type);
          const meta   = SIGNAL_TYPE_META[type] ?? SIGNAL_TYPE_META.unknown;
          return (
            <button
              key={type}
              className={`btn${active ? " btn-primary" : ""}`}
              style={{
                padding:     "3px 10px",
                fontSize:    10,
                background:  active ? C.greenDim    : "transparent",
                borderColor: active ? C.greenBorder : C.border0,
                color:       active ? C.green       : C.textDisabled,
              }}
              onClick={() => toggleSignalType(type)}
            >
              {meta.label}
            </button>
          );
        })}

        {/* Theme selector */}
        {hasThemes && (
          <select
            value={filters.theme ?? ""}
            onChange={e => setFilter("theme", e.target.value || null)}
            style={{
              background:  C.bgInset,
              border:      `1px solid ${filters.theme ? C.greenBorder : C.border0}`,
              borderRadius: 4,
              color:        filters.theme ? C.green : C.textDisabled,
              fontFamily:   C.fontData,
              fontSize:     10,
              padding:      "3px 8px",
              cursor:       "pointer",
              outline:      "none",
            }}
          >
            <option value="">All themes</option>
            {options.themes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {/* Score threshold */}
        <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-1)" }}>
          <span className="t-label">Score ≥</span>
          {SCORE_THRESHOLDS.map(threshold => {
            const active = filters.minScore === threshold;
            return (
              <button
                key={threshold}
                className={`btn${active ? " btn-primary" : ""}`}
                style={{
                  padding:     "3px 7px",
                  fontSize:    10,
                  background:  active ? C.greenDim    : "transparent",
                  borderColor: active ? C.greenBorder : C.border0,
                  color:       active ? C.green       : C.textDisabled,
                }}
                onClick={() => setFilter("minScore", active ? 0 : threshold)}
              >
                {threshold === 0 ? "Any" : threshold}
              </button>
            );
          })}
        </div>

        {/* Reset + result count */}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"var(--sp-3)" }}>
          <span className="t-label" style={{ color: resultCount < totalCount ? C.amber : C.textDisabled }}>
            {resultCount === totalCount
              ? `${totalCount} shown`
              : `${resultCount} of ${totalCount}`}
          </span>
          {activeCount > 0 && (
            <button className="btn" style={{ padding:"3px 8px", fontSize:10 }} onClick={resetFilters}>
              Clear {activeCount > 1 ? `(${activeCount})` : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RunStats({ summary }) {
  if (!summary) return null;
  const items = [
    { label: "Candidates",    value: summary.candidates   },
    { label: "Posts read",    value: summary.postsIngested },
    { label: "Tickers found", value: summary.uniqueTickers },
  ].filter(i => i.value != null);

  return (
    <div style={{ display:"flex", gap:"var(--sp-5)", padding:"var(--sp-3) 0", marginBottom:"var(--sp-4)", borderBottom:`1px solid ${C.border0}` }}>
      {items.map(({ label, value }) => (
        <div key={label}>
          <div className="t-label" style={{ marginBottom:2 }}>{label}</div>
          <div style={{ fontFamily:C.fontData, fontSize:13, color:C.textPrimary }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ExcludedRow({ item }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"60px 60px 1fr", alignItems:"center", gap:"var(--sp-3)", padding:"6px 0", borderBottom:`1px solid ${C.border0}` }}>
      <span style={{ fontFamily:C.fontData, fontSize:11, color:C.textDisabled }}>{item.ticker}</span>
      <span className="badge badge-neutral" style={{ fontSize:8 }}>{item.exclusionRule}</span>
      <span className="t-body" style={{ fontSize:10, color:C.textDisabled }}>
        {item.reason?.slice(0, 80)}{item.reason?.length > 80 ? "…" : ""}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DraftBoard() {
  const [candidates,   setCandidates]   = useState([]);
  const [excluded,     setExcluded]     = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [fetchedAt,    setFetchedAt]    = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);

  const {
    filters, setFilter, toggleSignalType, resetFilters,
    filtered, options, activeCount, isFiltered,
  } = useFilters(candidates);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/pipeline/run?dry=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCandidates(data.candidates ?? []);
      setExcluded(data.excluded     ?? []);
      setSummary(data.summary       ?? null);
      setFetchedAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const time = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })
    : null;

  const top = filtered[0];

  return (
    <div style={{ padding:"var(--sp-6)", maxWidth:760 }}>

      {/* Status */}
      <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-3)", marginBottom:"var(--sp-4)" }}>
        <div className="pip animate-live" style={{ background: error ? C.red : loading ? C.amber : C.green }} />
        <span className="t-label">
          {error ? `Error — ${error}` : loading ? "Running pipeline…" : time ? `Updated ${time}` : "Loading…"}
        </span>
        <button className="btn" style={{ marginLeft:"auto" }} onClick={load} disabled={loading}>
          {loading && <span className="spinner" style={{ marginRight:6 }} />}
          Refresh
        </button>
      </div>

      {error && <div className="error-block" style={{ marginBottom:"var(--sp-4)" }}>{error}</div>}

      {/* Run stats */}
      <RunStats summary={summary} />

      {/* Filter bar — only when candidates exist */}
      {candidates.length > 0 && (
        <FilterBar
          filters={filters}
          options={options}
          toggleSignalType={toggleSignalType}
          setFilter={setFilter}
          resetFilters={resetFilters}
          activeCount={activeCount}
          resultCount={filtered.length}
          totalCount={candidates.length}
        />
      )}

      {/* Top signal callout — tracks filtered top, not global top */}
      {top && (
        <div className="card-inset card--green" style={{
          padding:"var(--sp-3) var(--sp-4)", marginBottom:"var(--sp-4)",
          display:"flex", gap:"var(--sp-3)", alignItems:"flex-start",
        }}>
          <span className="t-label t-green" style={{ flexShrink:0, paddingTop:2 }}>
            {isFiltered ? "Top match" : "Top signal"}
          </span>
          <span style={{ ...S.ticker, color:C.green, flexShrink:0 }}>{top.ticker}</span>
          <span className="t-body" style={{ color:C.textTertiary }}>
            {top.narrativeSummary?.slice(0, 120)}{(top.narrativeSummary?.length ?? 0) > 120 ? "…" : ""}
          </span>
        </div>
      )}

      {/* Candidate cards */}
      {filtered.length === 0 && !loading ? (
        <div className="empty-state">
          {isFiltered ? "No candidates match the active filters" : "No candidates — run the pipeline"}
        </div>
      ) : (
        <>
          <div className="section-head">
            {isFiltered
              ? `${filtered.length} of ${candidates.length} candidates`
              : `${filtered.length} candidate${filtered.length !== 1 ? "s" : ""}`}
            {" — click to expand"}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-2)" }}>
            {filtered.map((c, i) => (
              <CandidateCard
                key={c.ticker}
                candidate={c}
                rank={i + 1}
                isTop={i === 0}
              />
            ))}
          </div>
        </>
      )}

      {/* Excluded */}
      {excluded.length > 0 && (
        <div style={{ marginTop:"var(--sp-5)" }}>
          <button
            className="btn"
            style={{ width:"100%", justifyContent:"space-between" }}
            onClick={() => setShowExcluded(e => !e)}
          >
            <span>{excluded.length} excluded — {showExcluded ? "hide" : "show reasons"}</span>
            <span style={{ transition:"transform 0.18s", transform: showExcluded ? "rotate(180deg)" : "none" }}>⌄</span>
          </button>
          {showExcluded && (
            <div className="card-inset" style={{ padding:"var(--sp-3) var(--sp-4)", marginTop:"var(--sp-3)" }}>
              <div className="t-label" style={{ marginBottom:"var(--sp-3)" }}>Excluded from shortlist</div>
              {excluded.map(e => <ExcludedRow key={e.ticker} item={e} />)}
            </div>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <p className="t-label" style={{ marginTop:"var(--sp-6)", textAlign:"center" }}>
          Not financial advice — discovery signals only
        </p>
      )}
    </div>
  );
}
