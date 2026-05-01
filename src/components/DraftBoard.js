"use client";
// components/DraftBoard.jsx
//
// Decision surface for the DraftBoard discovery pipeline.
//
// Reads from /api/pipeline/run — which returns FinalCandidate[] from the
// full pipeline: scored → analyzed → shortlisted.
//
// Each card shows what matters for a decision:
//   ticker + rank, signal type, score, narrative, catalyst.
// Each card hides what doesn't: raw mention counts, subreddit lists,
//   score breakdowns, rule traces. Those live in the detail panel.
//
// Data contract (FinalCandidate from shortlist.js):
//   ticker, adjustedScore, signalType, confidence, narrativeSummary,
//   keyCatalyst, keyRisk, mentions, velocity, scoreBreakdown, appliedRules

import { useState, useEffect, useCallback } from "react";
import { C, S, scoreColor } from "../lib/ui/tokens";

const REFRESH_MS     = 5 * 60 * 1000; // 5 minutes — pipeline runs take time
const SIGNAL_WEIGHTS = { thesis: 3, news: 2, mixed: 1, hype: 1, unknown: 0 };

// ─── Token-aligned constants ──────────────────────────────────────────────────

const SIGNAL_TYPE_META = {
  thesis:  { label: "Thesis",  badgeClass: "badge-green",   description: "Reasoned investment argument" },
  news:    { label: "News",    badgeClass: "badge-amber",   description: "Catalyst-driven attention"    },
  mixed:   { label: "Mixed",   badgeClass: "badge-neutral", description: "Split thesis and hype"        },
  hype:    { label: "Hype",    badgeClass: "badge-neutral", description: "Sentiment without evidence"   },
  unknown: { label: "Signal",  badgeClass: "badge-neutral", description: "Insufficient post data"       },
};

const CONFIDENCE_META = {
  high:   { label: "High confidence",   dotColor: C.green  },
  medium: { label: "Medium confidence", dotColor: C.amber  },
  low:    { label: "Low confidence",    dotColor: C.slate  },
};

const VELOCITY_META = {
  high:   { label: "Rising",  color: C.green  },
  medium: { label: "Steady",  color: C.amber  },
  low:    { label: "Fading",  color: C.slate  },
};

// ─── Score arc ────────────────────────────────────────────────────────────────

function ScoreArc({ score, size = 52 }) {
  const color = scoreColor(score);
  const r     = (size - 5) / 2;
  const cx    = size / 2;
  const cy    = size / 2;
  const circ  = 2 * Math.PI * r;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r}
          fill="none" stroke={C.border1} strokeWidth="3.5" />
        <circle cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.16,1,0.3,1)" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{
          fontFamily: C.fontData, fontSize: 12, fontWeight: 500,
          color, letterSpacing: "-0.02em",
        }}>
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

// ─── Score breakdown ──────────────────────────────────────────────────────────

function ScoreBreakdown({ breakdown }) {
  if (!breakdown) return null;

  const rows = [
    ["Base",          breakdown.baseScore],
    ["Concentration", breakdown.concentrationScore],
    ["Consistency",   breakdown.consistencyScore],
    ["Quality",       breakdown.qualityScore],
    ["Penalty",       breakdown.penaltyAdjustment],
    ["Filter",        breakdown.filterAdjustment],
  ].filter(([, v]) => v != null && v !== 0);

  return (
    <div style={{
      marginTop: "var(--sp-3)",
      paddingTop: "var(--sp-3)",
      borderTop: `1px solid ${C.border0}`,
    }}>
      <div className="t-label" style={{ marginBottom: "var(--sp-2)" }}>Score breakdown</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map(([label, value]) => {
          const isPenalty = value < 0;
          const color     = isPenalty ? C.red : C.textTertiary;
          return (
            <div key={label} style={{
              display: "grid",
              gridTemplateColumns: "100px 1fr 28px",
              alignItems: "center",
              gap: 8,
            }}>
              <span className="t-label">{label}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{
                  width:      `${Math.abs(value)}%`,
                  background: isPenalty ? C.red : C.slate,
                }} />
              </div>
              <span style={{
                fontFamily: C.fontData, fontSize: 10,
                color, textAlign: "right",
              }}>
                {isPenalty ? value : `+${value}`}
              </span>
            </div>
          );
        })}
        <div style={{
          display: "flex", justifyContent: "space-between",
          paddingTop: "var(--sp-1)",
          borderTop: `1px solid ${C.border0}`,
        }}>
          <span className="t-label">Adjusted</span>
          <span style={{
            fontFamily: C.fontData, fontSize: 11,
            color: scoreColor(breakdown.adjustedScore), fontWeight: 500,
          }}>
            {breakdown.adjustedScore}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main candidate card ──────────────────────────────────────────────────────

function CandidateCard({ candidate, rank, isTop }) {
  const [expanded, setExpanded] = useState(false);

  const {
    ticker, adjustedScore, signalType, confidence,
    narrativeSummary, keyCatalyst, keyRisk,
    mentions, velocity, scoreBreakdown, appliedRules,
  } = candidate;

  const sm   = SIGNAL_TYPE_META[signalType]  ?? SIGNAL_TYPE_META.unknown;
  const cm   = CONFIDENCE_META[confidence]   ?? CONFIDENCE_META.low;
  const vm   = VELOCITY_META[velocity]       ?? VELOCITY_META.low;
  const sc   = scoreColor(adjustedScore);
  const weak = SIGNAL_WEIGHTS[signalType] <= 1;

  return (
    <div
      className={`card animate-card${isTop ? " card--green" : ""}`}
      style={{
        padding: "var(--sp-3) var(--sp-4)",
        opacity: weak ? 0.72 : 1,
        animationDelay: `${rank * 45}ms`,
        cursor: "pointer",
        transition: "opacity 0.2s, border-color 0.2s",
      }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* ── Row 1: rank + ticker + badges + score ── */}
      <div style={{
        display: "flex", alignItems: "center",
        gap: "var(--sp-3)", marginBottom: "var(--sp-3)",
      }}>
        {/* Rank */}
        <span className="t-label" style={{ width: 18, flexShrink: 0 }}>
          #{rank}
        </span>

        {/* Score arc */}
        <ScoreArc score={adjustedScore} />

        {/* Ticker + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center",
            gap: "var(--sp-2)", marginBottom: 5, flexWrap: "wrap",
          }}>
            <span style={S.ticker}>{ticker}</span>
            <span className={`badge ${sm.badgeClass}`}>{sm.label}</span>
          </div>

          {/* Confidence row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div className="pip" style={{ background: cm.dotColor }} />
            <span className="t-label">{cm.label}</span>
            <span className="divider-v" style={{ height: 10 }} />
            <span className="t-label" style={{ color: vm.color }}>{vm.label}</span>
          </div>
        </div>

        {/* Expand indicator */}
        <span style={{
          color: C.textDisabled, fontSize: 14, flexShrink: 0,
          transition: "transform 0.18s",
          transform: expanded ? "rotate(180deg)" : "none",
        }}>
          ⌄
        </span>
      </div>

      {/* ── Row 2: narrative ── */}
      {narrativeSummary && (
        <p className="t-body" style={{ marginBottom: keyCatalyst ? "var(--sp-2)" : 0 }}>
          {narrativeSummary}
        </p>
      )}

      {/* ── Row 3: catalyst (only if present) ── */}
      {keyCatalyst && (
        <div style={{
          display: "flex", gap: "var(--sp-2)", alignItems: "flex-start",
          marginTop: "var(--sp-2)",
        }}>
          <span className="t-label" style={{
            color: C.amber, paddingTop: 1, flexShrink: 0, whiteSpace: "nowrap",
          }}>
            Catalyst
          </span>
          <span className="t-body" style={{ color: C.textSecondary }}>
            {keyCatalyst}
          </span>
        </div>
      )}

      {/* ── Expanded: risk + score breakdown + rules ── */}
      {expanded && (
        <div style={{
          marginTop: "var(--sp-3)",
          paddingTop: "var(--sp-3)",
          borderTop: `1px solid ${C.border0}`,
        }}>
          {/* Risk */}
          {keyRisk && (
            <div style={{
              display: "flex", gap: "var(--sp-2)", alignItems: "flex-start",
              marginBottom: "var(--sp-3)",
            }}>
              <span className="t-label" style={{
                color: C.red, paddingTop: 1, flexShrink: 0, whiteSpace: "nowrap",
              }}>
                Risk
              </span>
              <span className="t-body">{keyRisk}</span>
            </div>
          )}

          {/* Supporting metrics */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
            gap: "var(--sp-3)", marginBottom: "var(--sp-3)",
          }}>
            <div>
              <div className="t-label" style={{ marginBottom: 3 }}>Mentions</div>
              <div style={{ fontFamily: C.fontData, fontSize: 15, color: C.textPrimary }}>
                {mentions}
              </div>
            </div>
            <div>
              <div className="t-label" style={{ marginBottom: 3 }}>Signal type</div>
              <div style={{ fontFamily: C.fontData, fontSize: 11, color: C.textSecondary }}>
                {sm.description}
              </div>
            </div>
          </div>

          {/* Score breakdown */}
          <ScoreBreakdown breakdown={scoreBreakdown} />

          {/* Applied rules (if any adjustments were made) */}
          {appliedRules?.length > 0 && (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <div className="t-label" style={{ marginBottom: "var(--sp-2)" }}>
                Filter adjustments
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {appliedRules.map((rule, i) => (
                  <span key={i} className="t-body" style={{
                    color: C.textDisabled, fontSize: 10,
                    fontFamily: C.fontData,
                  }}>
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Excluded ticker row ──────────────────────────────────────────────────────

function ExcludedRow({ item }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "60px 60px 1fr",
      alignItems: "center",
      gap: "var(--sp-3)",
      padding: "6px 0",
      borderBottom: `1px solid ${C.border0}`,
    }}>
      <span style={{ fontFamily: C.fontData, fontSize: 11, color: C.textDisabled }}>
        {item.ticker}
      </span>
      <span className="badge badge-neutral" style={{ fontSize: 8 }}>
        {item.exclusionRule}
      </span>
      <span className="t-body" style={{ fontSize: 10, color: C.textDisabled }}>
        {item.reason?.slice(0, 80)}{item.reason?.length > 80 ? "…" : ""}
      </span>
    </div>
  );
}

// ─── Run stats bar ────────────────────────────────────────────────────────────

function RunStats({ summary, stats }) {
  if (!summary) return null;

  const items = [
    { label: "Candidates",  value: summary.candidates },
    { label: "Posts read",  value: summary.postsIngested },
    { label: "Tickers found", value: summary.uniqueTickers },
    { label: "Retention",   value: stats ? `${stats.retentionRate}%` : null },
  ].filter(item => item.value != null);

  return (
    <div style={{
      display: "flex", gap: "var(--sp-5)", alignItems: "center",
      padding: "var(--sp-3) 0",
      marginBottom: "var(--sp-4)",
      borderBottom: `1px solid ${C.border0}`,
    }}>
      {items.map(({ label, value }) => (
        <div key={label}>
          <div className="t-label" style={{ marginBottom: 2 }}>{label}</div>
          <div style={{ fontFamily: C.fontData, fontSize: 13, color: C.textPrimary }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DraftBoard() {
  const [candidates, setCandidates] = useState([]);
  const [excluded,   setExcluded]   = useState([]);
  const [summary,    setSummary]    = useState(null);
  const [stats,      setStats]      = useState(null);
  const [fetchedAt,  setFetchedAt]  = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/pipeline/run?dry=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setCandidates(data.candidates ?? []);
      setExcluded(data.excluded     ?? []);
      setSummary(data.summary       ?? null);
      setStats(data.meta?.stages?.shortlist ?? null);
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
    ? new Date(fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const top = candidates[0];

  return (
    <div style={{ padding: "var(--sp-6)", maxWidth: 760 }}>

      {/* ── Status bar ── */}
      <div style={{
        display: "flex", alignItems: "center",
        gap: "var(--sp-3)", marginBottom: "var(--sp-4)",
      }}>
        <div className="pip animate-live" style={{
          background: error ? C.red : loading ? C.amber : C.green,
        }} />
        <span className="t-label">
          {error   ? `Error — ${error}`
           : loading ? "Running pipeline…"
           : time    ? `Updated ${time}`
           :           "Loading…"}
        </span>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={load}
          disabled={loading}
        >
          {loading && <span className="spinner" style={{ marginRight: 6 }} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="error-block" style={{ marginBottom: "var(--sp-4)" }}>
          {error}
        </div>
      )}

      {/* ── Run stats ── */}
      <RunStats summary={summary} stats={stats} />

      {/* ── Top signal callout ── */}
      {top && (
        <div className="card-inset card--green" style={{
          padding: "var(--sp-3) var(--sp-4)",
          marginBottom: "var(--sp-4)",
          display: "flex", gap: "var(--sp-3)", alignItems: "flex-start",
        }}>
          <span className="t-label t-green" style={{ flexShrink: 0, paddingTop: 2 }}>
            Top signal
          </span>
          <span style={{ ...S.ticker, color: C.green, flexShrink: 0 }}>
            {top.ticker}
          </span>
          <span className="t-body" style={{ color: C.textTertiary }}>
            {top.narrativeSummary?.slice(0, 120)}
            {(top.narrativeSummary?.length ?? 0) > 120 ? "…" : ""}
          </span>
        </div>
      )}

      {/* ── Candidate cards ── */}
      {candidates.length === 0 && !loading ? (
        <div className="empty-state">No candidates — run the pipeline</div>
      ) : (
        <>
          <div className="section-head">
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""} — click to expand
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {candidates.map((c, i) => (
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

      {/* ── Excluded tickers (collapsed by default) ── */}
      {excluded.length > 0 && (
        <div style={{ marginTop: "var(--sp-5)" }}>
          <button
            className="btn"
            style={{ width: "100%", justifyContent: "space-between" }}
            onClick={() => setShowExcluded(e => !e)}
          >
            <span>{excluded.length} excluded — {showExcluded ? "hide" : "show reasons"}</span>
            <span style={{
              transition: "transform 0.18s",
              transform: showExcluded ? "rotate(180deg)" : "none",
            }}>⌄</span>
          </button>

          {showExcluded && (
            <div style={{
              marginTop: "var(--sp-3)",
              padding: "var(--sp-3) var(--sp-4)",
            }} className="card-inset">
              <div className="t-label" style={{ marginBottom: "var(--sp-3)" }}>
                Excluded from shortlist
              </div>
              {excluded.map(e => (
                <ExcludedRow key={e.ticker} item={e} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      {candidates.length > 0 && (
        <p className="t-label" style={{
          marginTop: "var(--sp-6)", textAlign: "center",
        }}>
          Not financial advice — discovery signals only
        </p>
      )}
    </div>
  );
}
