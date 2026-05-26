// /lib/pipeline/shortlist.js
//
// Stage 8: Shortlist filtering.
//
// Takes the scored + AI-analyzed signal batch and applies explicit,
// ordered rules to produce a final candidate list.
//
// Design principle: every decision is explainable.
// Every candidate carries why it was kept.
// Every excluded ticker carries why it was dropped.
// No score thresholds are buried — all live in FILTER_CONFIG below.
//
// Rule precedence (applied in order):
//   1. Hard exclusions  — always drop, no override
//   2. Soft down-ranks  — reduce score, still eligible
//   3. Quality gate     — minimum final score after adjustments
//   4. Size cap         — return at most maxCandidates
//
// Fallback source types (from analyze.js):
//   "claude"                  — AI succeeded, no penalty
//   "deterministic_fallback"  — AI intentionally skipped (analyze:false) → S3 applies
//   "claude_timeout_fallback" — API timed out transiently → S3 does NOT apply
//   "claude_missing_fallback" — AI returned fewer results than expected → S3 applies

// ─── Filter config ────────────────────────────────────────────────────────────

export const FILTER_CONFIG = {
  // Hard exclusion thresholds
  hardExclude: {
    maxPenaltyForHype:         -10,   // if penalty ≤ this AND signal_type is hype → exclude
    maxPenaltyAbsolute:        -25,   // if penalty ≤ this regardless of type → exclude
    minFinalScoreAbsolute:      15,   // below this, always exclude (not worth analysis time)
  },

  // Soft down-rank adjustments (subtracted from finalScore before gate)
  downrank: {
    hypeSignal:                 12,   // penalize hype-classified signals
    lowConfidence:               8,   // penalize low-confidence AI classification
    deterministicFallback:       5,   // slight penalty when AI wasn't available (intentional skip)
    noAnalysis:                  3,   // minor penalty when analysis field is null
    mixedSignal:                 4,   // mixed signals are less actionable
  },

  // Quality gate — minimum adjusted score to appear in shortlist
  minAdjustedScore:             35,

  // Signal type preferences — used for tiebreaking and display sorting
  signalTypeRank: {
    thesis:  4,
    news:    3,
    mixed:   2,
    hype:    1,
    unknown: 1,
  },

  // Confidence preferences
  confidenceRank: {
    high:   3,
    medium: 2,
    low:    1,
  },

  // Output size
  maxCandidates: 10,
};

// ─── Rule definitions ─────────────────────────────────────────────────────────

const HARD_EXCLUSION_RULES = [

  // Rule H1: Absolute score floor
  function scoreTooLow(signal) {
    if (signal.finalScore < FILTER_CONFIG.hardExclude.minFinalScoreAbsolute) {
      return {
        action: "exclude",
        rule:   "H1",
        reason: `Final score ${signal.finalScore} is below absolute minimum (${FILTER_CONFIG.hardExclude.minFinalScoreAbsolute})`,
      };
    }
    return { action: "pass" };
  },

  // Rule H2: Extreme penalty regardless of signal type
  function extremePenalty(signal) {
    const penalty = signal.penaltyAdjustment ?? 0;
    if (penalty <= FILTER_CONFIG.hardExclude.maxPenaltyAbsolute) {
      return {
        action: "exclude",
        rule:   "H2",
        reason: `Penalty adjustment ${penalty} exceeds hard limit (${FILTER_CONFIG.hardExclude.maxPenaltyAbsolute}). Likely spam or coordinated spike.`,
      };
    }
    return { action: "pass" };
  },

  // Rule H3: Hype signal with significant penalty
  function hypePlusPenalty(signal) {
    const type    = signal.analysis?.signal_type;
    const penalty = signal.penaltyAdjustment ?? 0;
    if (type === "hype" && penalty <= FILTER_CONFIG.hardExclude.maxPenaltyForHype) {
      return {
        action: "exclude",
        rule:   "H3",
        reason: `Hype classification combined with penalty (${penalty}) indicates low-value signal. No investment analysis bandwidth warranted.`,
      };
    }
    return { action: "pass" };
  },

  // Rule H4: Low confidence + hype = hard exclude
  function lowConfidenceHype(signal) {
    const type       = signal.analysis?.signal_type;
    const confidence = signal.analysis?.confidence;
    if (type === "hype" && confidence === "low") {
      return {
        action: "exclude",
        rule:   "H4",
        reason: "Hype signal with low confidence — insufficient evidence to justify investigation.",
      };
    }
    return { action: "pass" };
  },
];

const SOFT_DOWNRANK_RULES = [

  // Rule S1: Hype signal (without hard exclusion)
  function downrankHype(signal) {
    if (signal.analysis?.signal_type === "hype") {
      return {
        action: "downrank",
        rule:   "S1",
        amount: FILTER_CONFIG.downrank.hypeSignal,
        reason: `Hype classification — down-ranked by ${FILTER_CONFIG.downrank.hypeSignal} points. May still be worth monitoring if score remains above threshold.`,
      };
    }
    return { action: "pass" };
  },

  // Rule S2: Low AI confidence
  function downrankLowConfidence(signal) {
    if (signal.analysis?.confidence === "low") {
      return {
        action: "downrank",
        rule:   "S2",
        amount: FILTER_CONFIG.downrank.lowConfidence,
        reason: `Low confidence classification (insufficient post data) — down-ranked by ${FILTER_CONFIG.downrank.lowConfidence} points.`,
      };
    }
    return { action: "pass" };
  },

  // Rule S3: Deterministic fallback (AI was intentionally skipped or missing)
  //
  // IMPORTANT: "claude_timeout_fallback" is excluded from this penalty.
  // A transient API timeout should not permanently degrade a signal's score.
  // Only apply the penalty when AI was intentionally not run (analyze:false)
  // or when Claude returned an incomplete response (claude_missing_fallback).
  function downrankFallback(signal) {
    const source = signal.analysis?.source;

    // Timeout fallback: transient failure, not the signal's fault — no penalty
    if (source === "claude_timeout_fallback") {
      return { action: "pass" };
    }

    // Intentional skip or missing result — apply normal penalty
    if (source === "deterministic_fallback" || source === "claude_missing_fallback") {
      return {
        action: "downrank",
        rule:   "S3",
        amount: FILTER_CONFIG.downrank.deterministicFallback,
        reason: `AI analysis unavailable (${source}) — deterministic fallback used. Down-ranked by ${FILTER_CONFIG.downrank.deterministicFallback} points.`,
      };
    }

    return { action: "pass" };
  },

  // Rule S4: No analysis attached at all
  function downrankNoAnalysis(signal) {
    if (!signal.analysis) {
      return {
        action: "downrank",
        rule:   "S4",
        amount: FILTER_CONFIG.downrank.noAnalysis,
        reason: `No analysis attached — analysis stage may have been skipped. Down-ranked by ${FILTER_CONFIG.downrank.noAnalysis} points.`,
      };
    }
    return { action: "pass" };
  },

  // Rule S5: Mixed signal
  function downrankMixed(signal) {
    if (signal.analysis?.signal_type === "mixed") {
      return {
        action: "downrank",
        rule:   "S5",
        amount: FILTER_CONFIG.downrank.mixedSignal,
        reason: `Mixed signal classification (split between thesis/news and hype) — down-ranked by ${FILTER_CONFIG.downrank.mixedSignal} points.`,
      };
    }
    return { action: "pass" };
  },
];

// ─── Core filtering logic ─────────────────────────────────────────────────────

function evaluateSignal(signal) {
  const appliedRules = [];
  let   adjustment   = 0;

  // Phase 1: Hard exclusions
  for (const rule of HARD_EXCLUSION_RULES) {
    const result = rule(signal);
    if (result.action === "exclude") {
      return {
        ticker:        signal.ticker,
        decision:      "exclude",
        adjustedScore: signal.finalScore,
        appliedRules:  [result.rule],
        exclusionRule: result.rule,
        reason:        result.reason,
      };
    }
  }

  // Phase 2: Soft down-ranks
  for (const rule of SOFT_DOWNRANK_RULES) {
    const result = rule(signal);
    if (result.action === "downrank") {
      adjustment   += result.amount;
      appliedRules.push(`${result.rule}: -${result.amount} (${result.reason})`);
    }
  }

  const adjustedScore = Math.max(0, Math.round((signal.finalScore - adjustment) * 10) / 10);

  // Phase 3: Quality gate
  if (adjustedScore < FILTER_CONFIG.minAdjustedScore) {
    return {
      ticker:        signal.ticker,
      decision:      "exclude",
      adjustedScore,
      appliedRules,
      exclusionRule: "G1",
      reason:        `Adjusted score ${adjustedScore} is below quality gate (${FILTER_CONFIG.minAdjustedScore}) after ${adjustment > 0 ? `${adjustment}-point` : "no"} down-ranks.`,
    };
  }

  const reason = appliedRules.length > 0
    ? `Included with adjustments: ${appliedRules.join("; ")}`
    : "Included — passed all rules without adjustment.";

  return {
    ticker:        signal.ticker,
    decision:      "include",
    adjustedScore,
    appliedRules,
    exclusionRule: null,
    reason,
  };
}

// ─── Sort key ─────────────────────────────────────────────────────────────────

function sortKey(candidate) {
  const typeRank = FILTER_CONFIG.signalTypeRank[candidate.signalType] ?? 1;
  const confRank = FILTER_CONFIG.confidenceRank[candidate.confidence] ?? 1;
  return candidate.adjustedScore * 1000 + typeRank * 10 + confRank;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildShortlist(signals, config = {}) {
  if (!signals || signals.length === 0) {
    return { candidates: [], excluded: [], stats: buildStats([], []) };
  }

  const cfg = { ...FILTER_CONFIG, ...config };

  const candidates = [];
  const excluded   = [];

  for (const signal of signals) {
    const evaluation = evaluateSignal(signal);

    if (evaluation.decision === "include") {
      candidates.push({
        ticker:           signal.ticker,
        finalScore:       signal.finalScore,
        adjustedScore:    evaluation.adjustedScore,
        signalType:       signal.analysis?.signal_type  ?? "unknown",
        confidence:       signal.analysis?.confidence   ?? "low",
        narrativeSummary: signal.analysis?.narrative_summary ?? null,
        keyCatalyst:      signal.analysis?.key_catalyst ?? null,
        keyRisk:          signal.analysis?.key_risk     ?? null,
        scoreBreakdown: {
          baseScore:          signal.baseScore,
          concentrationScore: signal.concentrationScore,
          consistencyScore:   signal.consistencyScore,
          qualityScore:       signal.qualityScore,
          penaltyAdjustment:  signal.penaltyAdjustment,
          finalScore:         signal.finalScore,
          filterAdjustment:   -(signal.finalScore - evaluation.adjustedScore),
          adjustedScore:      evaluation.adjustedScore,
        },
        appliedRules: evaluation.appliedRules,
        reason:       evaluation.reason,
        mentions:     signal.mentions,
        velocity:     signal.velocity,
        avgUpvotes:   signal.avgUpvotes,
        samplePosts:  signal.samplePosts,
      });
    } else {
      excluded.push({
        ticker:        signal.ticker,
        finalScore:    signal.finalScore,
        adjustedScore: evaluation.adjustedScore,
        exclusionRule: evaluation.exclusionRule,
        reason:        evaluation.reason,
        signalType:    signal.analysis?.signal_type ?? "unknown",
      });
    }
  }

  candidates.sort((a, b) => {
    const diff = sortKey(b) - sortKey(a);
    if (diff !== 0) return diff;
    return a.ticker.localeCompare(b.ticker);
  });

  const final = candidates.slice(0, cfg.maxCandidates);

  for (const c of candidates.slice(cfg.maxCandidates)) {
    excluded.push({
      ticker:        c.ticker,
      finalScore:    c.finalScore,
      adjustedScore: c.adjustedScore,
      exclusionRule: "CAP",
      reason:        `Passed all rules (adjusted score: ${c.adjustedScore}) but excluded by size cap (max ${cfg.maxCandidates}).`,
      signalType:    c.signalType,
    });
  }

  return {
    candidates: final,
    excluded,
    stats: buildStats(final, excluded),
  };
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function buildStats(candidates, excluded) {
  const total  = candidates.length + excluded.length;
  const byType = {};
  const byRule = {};

  for (const c of candidates) {
    byType[c.signalType] = (byType[c.signalType] ?? 0) + 1;
  }

  for (const e of excluded) {
    byRule[e.exclusionRule] = (byRule[e.exclusionRule] ?? 0) + 1;
  }

  const scores = candidates.map(c => c.adjustedScore);

  return {
    total,
    included:     candidates.length,
    excluded:     excluded.length,
    retentionRate: total > 0 ? Math.round((candidates.length / total) * 100) : 0,
    bySignalType: byType,
    byExclusionRule: byRule,
    avgAdjustedScore: scores.length
      ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 10) / 10
      : null,
    topTicker: candidates[0]?.ticker ?? null,
  };
}

export function summarizeShortlist(result) {
  const { candidates, excluded, stats } = result;
  const lines = [
    `[shortlist] ${stats.included} candidates, ${stats.excluded} excluded (${stats.retentionRate}% retention)`,
    ...candidates.map((c, i) =>
      `  #${i + 1} ${c.ticker} — ${c.adjustedScore} (${c.signalType}, ${c.confidence}) — ${c.narrativeSummary?.slice(0, 80) ?? "no narrative"}`
    ),
  ];
  if (excluded.length > 0) {
    lines.push(`  Excluded: ${excluded.map(e => `${e.ticker}(${e.exclusionRule})`).join(", ")}`);
  }
  return lines.join("\n");
}
