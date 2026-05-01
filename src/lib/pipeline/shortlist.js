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

// ─── Filter config ────────────────────────────────────────────────────────────
//
// All thresholds live here. Change thresholds here, nowhere else.

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
    deterministicFallback:       5,   // slight penalty when AI wasn't available
    noAnalysis:                  3,   // minor penalty when analysis field is null
    mixedSignal:                 4,   // mixed signals are less actionable
  },

  // Quality gate — minimum adjusted score to appear in shortlist
  minAdjustedScore:             35,

  // Signal type preferences — used for tiebreaking and display sorting
  // Higher = more preferred
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
//
// Each rule is a function that takes a signal and returns:
//   { action: "exclude", reason: string }  — drop this signal
//   { action: "downrank", amount: number, reason: string } — reduce score
//   { action: "pass" }  — no action

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
  // Hype alone is not excluded — hype + penalty is.
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
  // Low confidence alone is not excluded (handled by soft downrank).
  // Low confidence + hype together are not worth investigating.
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

  // Rule S3: Deterministic fallback (AI wasn't available for this ticker)
  function downrankFallback(signal) {
    if (signal.analysis?.source === "deterministic_fallback" ||
        signal.analysis?.source === "claude_missing_fallback") {
      return {
        action: "downrank",
        rule:   "S3",
        amount: FILTER_CONFIG.downrank.deterministicFallback,
        reason: `AI analysis unavailable — deterministic fallback used. Down-ranked by ${FILTER_CONFIG.downrank.deterministicFallback} points.`,
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

/**
 * Apply all rules to a single signal and return the decision record.
 *
 * @param {object} signal — merged RankedTicker with .analysis
 * @returns {{
 *   ticker:         string,
 *   decision:       "include" | "exclude",
 *   adjustedScore:  number,
 *   appliedRules:   string[],
 *   exclusionRule:  string | null,
 *   reason:         string,
 * }}
 */
function evaluateSignal(signal) {
  const appliedRules = [];
  let   adjustment   = 0;

  // Phase 1: Hard exclusions (checked in order, first match wins)
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

  // Phase 2: Soft down-ranks (all rules applied, adjustments accumulated)
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

  // Include
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
//
// Primary: adjustedScore DESC
// Secondary: signal type preference (thesis > news > mixed > hype/unknown)
// Tertiary: confidence (high > medium > low)
// Quaternary: ticker ASC (deterministic tiebreak)

function sortKey(candidate) {
  const typeRank = FILTER_CONFIG.signalTypeRank[candidate.signalType] ?? 1;
  const confRank = FILTER_CONFIG.confidenceRank[candidate.confidence] ?? 1;
  // Encode as a single comparable number (adjustedScore dominates)
  return candidate.adjustedScore * 1000 + typeRank * 10 + confRank;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Filter a ranked+analyzed signal batch down to the final candidate shortlist.
 *
 * @param {object[]} signals — RankedTicker[] with .analysis attached
 * @param {object}   config  — optional overrides to FILTER_CONFIG
 * @returns {ShortlistResult}
 */
export function buildShortlist(signals, config = {}) {
  if (!signals || signals.length === 0) {
    return { candidates: [], excluded: [], stats: buildStats([], []) };
  }

  const cfg = { ...FILTER_CONFIG, ...config };

  const candidates = [];
  const excluded   = [];

  // Evaluate every signal
  for (const signal of signals) {
    const evaluation = evaluateSignal(signal);

    if (evaluation.decision === "include") {
      candidates.push({
        // FinalCandidate schema
        ticker:           signal.ticker,
        finalScore:       signal.finalScore,
        adjustedScore:    evaluation.adjustedScore,
        signalType:       signal.analysis?.signal_type  ?? "unknown",
        confidence:       signal.analysis?.confidence   ?? "low",
        narrativeSummary: signal.analysis?.narrative_summary ?? null,
        keyCatalyst:      signal.analysis?.key_catalyst ?? null,
        keyRisk:          signal.analysis?.key_risk     ?? null,
        // Score breakdown for explainability
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
        // Applied rules for audit trail
        appliedRules: evaluation.appliedRules,
        reason:       evaluation.reason,
        // Pass-through for UI
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

  // Sort candidates by composite key, then apply size cap
  candidates.sort((a, b) => {
    const diff = sortKey(b) - sortKey(a);
    if (diff !== 0) return diff;
    return a.ticker.localeCompare(b.ticker); // deterministic final tiebreak
  });

  const final = candidates.slice(0, cfg.maxCandidates);

  // Any candidates cut by size cap go to excluded with explanation
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
  const total     = candidates.length + excluded.length;
  const byType    = {};
  const byRule    = {};

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

/**
 * Format the shortlist for logging / console output.
 * @param {ShortlistResult} result
 * @returns {string}
 */
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
