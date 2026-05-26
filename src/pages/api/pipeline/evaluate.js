// /lib/pipeline/evaluate.js
//
// Evaluation engine — measures whether surfaced signals were meaningful.
//
// Core principle from the architecture doc:
//   DraftBoard cannot observe price. It measures SIGNAL VALIDITY — whether
//   the attention pattern that caused a ticker to surface continued, deepened,
//   or resolved into substantive information within the evaluation window.
//
// Three outcome states (architecture doc definitions, reproduced verbatim):
//
//   "confirmed"    — ticker continued to generate high-quality discussion for
//                    3+ subsequent pipeline runs. Thesis or news catalyst referenced
//                    in the original signal was real and developed further.
//
//   "noise"        — ticker's attention spiked in one run and returned to baseline
//                    within 2 runs. Originating posts were hype or meme type with
//                    no follow-through.
//
//   "inconclusive" — ticker left the top-N list without a clear pattern. Not
//                    enough data to classify.
//
// No hindsight bias: evaluation only uses data that existed AFTER the surface time.
// It never looks back at the surface-time data to change the classification.
// The initial_score is frozen at surface time and never touched.

import {
  getPendingEvaluations,
  markEvaluated,
  saveEvaluation,
  getAccuracyStats,
  getSignalRecord,
  parseWindowMs,
  assertEvaluationRetentionConfig,
} from "@/lib/pipeline/evaluationStore";

import {
  getSnapshotsInRange,
} from "@/lib/pipeline/snapshotStore";

// ─── Evaluation config ────────────────────────────────────────────────────────

export const EVAL_CONFIG = {
  // Outcome thresholds
  confirmedMinRatio:          0.75,  // attention ratio >= this → rising/sustained
  noiseMaxRatio:              0.35,  // attention ratio <= this → gone/fading
  confirmedMinSnapshots:      3,     // must appear in at least this many snapshots
  noiseMaxSnapshots:          1,     // appeared in only this many → spike and gone
  confirmedConsistencyMin:    0.50,  // must appear in >= 50% of intervening snapshots

  // Outcome score weights
  outcomeWeights: {
    attentionRatio:    0.40,
    consistency:       0.35,
    crossSubreddit:    0.25,
  },
};

// ─── Metric: attention ratio ──────────────────────────────────────────────────
//
// mentionsAtEval / mentionsAtSurface
// Represents whether attention continued, held, or faded.
// Clamped to avoid extreme outliers inflating the score.

function computeAttentionRatio(mentionsAtSurface, mentionsAtEval) {
  if (mentionsAtSurface === 0) return mentionsAtEval > 0 ? 1.5 : 0;
  return Math.min(3.0, mentionsAtEval / mentionsAtSurface);
}

function classifyAttentionTrend(ratio) {
  if (ratio >= 1.5)  return "rising";
  if (ratio >= 0.75) return "sustained";
  if (ratio >= 0.25) return "fading";
  return "gone";
}

// ─── Metric: consistency ─────────────────────────────────────────────────────
//
// Fraction of intervening snapshots (between surfaceTime and evalTime)
// in which this ticker appeared with at least one mention.
//
// Rising/sustained attention across multiple snapshots = real interest.
// Single-snapshot spike = noise.

function computeConsistency(ticker, snapshots) {
  if (!snapshots || snapshots.length === 0) return 0;

  const appearances = snapshots.filter(snap =>
    snap.tickers.some(t => t.ticker === ticker && t.mentions > 0)
  ).length;

  return appearances / snapshots.length;
}

// ─── Metric: cross-subreddit spread ──────────────────────────────────────────
//
// Did the ticker appear across multiple subreddits in the eval snapshot?
// Organic interest tends to spread. Coordinated posts stay in one community.

function computeCrossSubreddit(ticker, evalSnapshot) {
  if (!evalSnapshot) return false;
  const record = evalSnapshot.tickers.find(t => t.ticker === ticker);
  return (record?.subreddits?.length ?? 0) >= 2;
}

// ─── Outcome score ────────────────────────────────────────────────────────────
//
// Composite 0–100 score measuring overall outcome quality.
// Higher = the signal was more valid.

function computeOutcomeScore(attentionRatio, consistency, crossSubreddit) {
  // Normalize attention ratio to [0, 100]
  // 0 = gone, 1.0 = same as surface, 3.0+ = tripled
  const ratioScore = Math.min(100, (attentionRatio / 3.0) * 100);

  // Consistency is already [0, 1] → [0, 100]
  const consistencyScore = consistency * 100;

  // Cross-subreddit is binary: 0 or 100
  const spreadScore = crossSubreddit ? 100 : 0;

  const w = EVAL_CONFIG.outcomeWeights;
  return Math.round(
    ratioScore      * w.attentionRatio +
    consistencyScore * w.consistency  +
    spreadScore      * w.crossSubreddit
  );
}

// ─── Outcome classification ───────────────────────────────────────────────────
//
// Deterministic rule application. Same inputs always produce same outcome.
// Rules applied in order — first match wins.

function classifyOutcome(attentionRatio, attentionTrend, snapshotsCounted, consistency, outcomeScore) {
  // Confirmed: sustained attention across multiple runs
  if (
    snapshotsCounted >= EVAL_CONFIG.confirmedMinSnapshots &&
    attentionRatio   >= EVAL_CONFIG.confirmedMinRatio    &&
    consistency      >= EVAL_CONFIG.confirmedConsistencyMin
  ) {
    return {
      outcome:      "confirmed",
      successFlag:  true,
      outcomeReason: `Appeared in ${snapshotsCounted} snapshots with ${Math.round(consistency * 100)}% consistency. Attention ${attentionTrend} (ratio: ${attentionRatio.toFixed(2)}).`,
    };
  }

  // Noise: spiked and disappeared
  if (
    snapshotsCounted <= EVAL_CONFIG.noiseMaxSnapshots &&
    attentionRatio   <= EVAL_CONFIG.noiseMaxRatio
  ) {
    return {
      outcome:      "noise",
      successFlag:  false,
      outcomeReason: `Attention ${attentionTrend} — appeared in only ${snapshotsCounted} snapshot(s). Ratio ${attentionRatio.toFixed(2)} indicates spike-and-fade pattern.`,
    };
  }

  // Inconclusive: mixed or insufficient data
  return {
    outcome:      "inconclusive",
    successFlag:  false,
    outcomeReason: `Insufficient pattern: ${snapshotsCounted} snapshots, ${Math.round(consistency * 100)}% consistency, attention ${attentionTrend}. Cannot classify as confirmed or noise.`,
  };
}

// ─── Single signal evaluation ─────────────────────────────────────────────────

/**
 * Evaluate one signal record against post-surface snapshot data.
 *
 * @param {SignalRecord} record    — from evaluationStore
 * @param {string}       window   — "24h" | "72h"
 * @returns {EvaluationResult}
 */
function evaluateRecord(record, window) {
  assertEvaluationRetentionConfig();
  const evalWindowMs = parseWindowMs(window);
  const surfacedAt   = record.surfacedAt;
  const evalAt       = surfacedAt + evalWindowMs;
  const now          = Date.now();

  // Collect snapshots between surfaceTime and evalTime
  // These are the only snapshots we're allowed to use — no hindsight
  const intervalSnapshots = getSnapshotsInRange(surfacedAt, Math.min(evalAt, now));

  // Latest snapshot in the eval window is the "eval snapshot"
  const evalSnapshot = intervalSnapshots.length > 0
    ? intervalSnapshots.reduce((latest, s) => s.createdAt > latest.createdAt ? s : latest)
    : null;

  // Find this ticker in the eval snapshot
  const evalRecord = evalSnapshot?.tickers?.find(t => t.ticker === record.ticker);
  const mentionsAtEval = evalRecord?.mentions ?? 0;

  // Compute metrics
  const attentionRatio    = computeAttentionRatio(record.mentionsAtSurface, mentionsAtEval);
  const attentionTrend    = classifyAttentionTrend(attentionRatio);
  const consistency       = computeConsistency(record.ticker, intervalSnapshots);
  const crossSubreddit    = computeCrossSubreddit(record.ticker, evalSnapshot);
  const snapshotsCounted  = intervalSnapshots.filter(s =>
    s.tickers.some(t => t.ticker === record.ticker)
  ).length;
  const outcomeScore      = computeOutcomeScore(attentionRatio, consistency, crossSubreddit);

  // Classify
  const classification = classifyOutcome(
    attentionRatio, attentionTrend, snapshotsCounted, consistency, outcomeScore
  );

  return {
    evalId:            `eval_${record.recordId}_${window}`,
    recordId:          record.recordId,
    ticker:            record.ticker,
    window,
    evaluatedAt:       now,
    // Frozen initial state — never modified after surfacing
    initialScore:      record.adjustedScore,
    initialSignalType: record.signalType,
    initialConfidence: record.confidence,
    mentionsAtSurface: record.mentionsAtSurface,
    // Outcome metrics
    mentionsAtEval,
    attentionRatio:    Math.round(attentionRatio * 100) / 100,
    attentionTrend,
    crossSubreddit,
    snapshotsCounted,
    consistencyScore:  Math.round(consistency * 100) / 100,
    outcomeScore,
    // Classification
    outcome:           classification.outcome,
    successFlag:       classification.successFlag,
    outcomeReason:     classification.outcomeReason,
    // Data quality
    snapshotsAvailable: intervalSnapshots.length,
    evalSnapshotId:    evalSnapshot?.snapshotId ?? null,
  };
}

// ─── Batch evaluation ─────────────────────────────────────────────────────────

/**
 * Run all pending evaluations for a given window.
 * Called by the scheduler on its cadence.
 *
 * @param {string} window — "24h" | "72h"
 * @returns {{ evaluated: number, results: EvaluationResult[] }}
 */
export async function runPendingEvaluations(window = "24h") {
  assertEvaluationRetentionConfig();
  const pending = getPendingEvaluations(window);

  if (pending.length === 0) {
    console.log(`[evaluate] No pending evaluations for window ${window}`);
    return { evaluated: 0, results: [] };
  }

  console.log(`[evaluate] Running ${pending.length} evaluations for window ${window}`);

  const results = [];

  for (const record of pending) {
    try {
      const result = evaluateRecord(record, window);
      saveEvaluation(result);
      markEvaluated(record.recordId, window);
      results.push(result);

      console.log(
        `[evaluate] ${record.ticker} (${window}): ${result.outcome} ` +
        `— score ${result.outcomeScore}, ${result.attentionTrend}, ` +
        `${result.snapshotsCounted} snapshots`
      );
    } catch (err) {
      console.error(`[evaluate] Failed for ${record.ticker}:`, err.message);
    }
  }

  // Log accuracy stats after each batch
  const stats = getAccuracyStats();
  if (stats.total > 0) {
    console.log(
      `[evaluate] Cumulative accuracy: ${stats.accuracy}% ` +
      `(${stats.confirmed} confirmed, ${stats.noise} noise, ${stats.inconclusive} inconclusive)`
    );
  }

  return { evaluated: results.length, results };
}

/**
 * Evaluate a single record on demand (for testing / manual review).
 *
 * @param {string} recordId
 * @param {string} window
 * @returns {EvaluationResult|null}
 */
export function evaluateOne(recordId, window = "24h") {
  const record = getSignalRecord(recordId);
  if (!record) return null;
  return evaluateRecord(record, window);
}
