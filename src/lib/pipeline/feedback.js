// /lib/pipeline/feedback.js
//
// Feedback loop for DraftBoard.
//
// Reads evaluation outcomes and generates weight adjustment recommendations.
//
// Architecture doc rule (reproduced):
//   "Learning is logged, not auto-applied."
//   "Score calibration: if signals of type X consistently produce Confirmed
//    outcomes, their weight increases. If they consistently produce Noise,
//    their weight decreases. This is deterministic weight adjustment based
//    on observed accuracy rates."
//
// What this module does:
//   1. Aggregates evaluation results across all completed outcomes
//   2. Identifies which signal characteristics correlated with confirmation
//   3. Computes directional weight adjustment recommendations
//   4. Logs a LearningRecord — a proposed diff against current weights
//
// What this module does NOT do:
//   - Modify weights directly (that is a human action)
//   - Call the pipeline or trigger re-scoring
//   - Use AI interpretation
//
// All logic is deterministic. Same evaluation data → same recommendations.

import fs   from "fs";
import path from "path";
import { getAllEvaluations, getAccuracyStats } from "./evaluationStore.js";
import { BASE_WEIGHTS, MODIFIER_WEIGHTS }      from "./prioritize.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export const FEEDBACK_CONFIG = {
  // Minimum evaluations needed before generating recommendations
  minEvaluations:       10,

  // Minimum evaluations per subgroup for a subgroup to influence recommendations
  minSubgroupSize:       5,

  // Maximum adjustment per dimension per learning cycle (fraction of current weight)
  maxAdjustmentFraction: 0.15,  // ±15% of current weight per cycle

  // Confirmation rate thresholds for directional signals
  strongPositiveThreshold: 0.70,  // rate >= this → increase weight
  weakPositiveThreshold:   0.55,  // rate >= this → slight increase
  weakNegativeThreshold:   0.40,  // rate <= this → slight decrease
  strongNegativeThreshold: 0.25,  // rate <= this → decrease weight

  // Learning record persistence
  dataDir:    path.join(process.cwd(), ".data"),
  recordsFile: path.join(process.cwd(), ".data", "learning_records.json"),
  maxRecords:  200,
};

// ─── Learning record schema ───────────────────────────────────────────────────

/**
 * @typedef {Object} LearningRecord
 *
 * A single learning cycle output. Append-only, never modified after creation.
 *
 * @property {string}   recordId
 * @property {number}   generatedAt         — unix ms
 * @property {number}   evaluationsAnalyzed — total evaluations used
 * @property {number}   windowDays          — how many days of data this covers
 * @property {boolean}  hasEnoughData       — false if below minEvaluations
 *
 * @property {AccuracyBreakdown} accuracyBreakdown
 * @property {DimensionAnalysis[]} dimensionAnalyses
 * @property {WeightRecommendation[]} recommendations
 * @property {string} summary — human-readable one-liner
 * @property {string} status  — "actionable" | "insufficient_data" | "stable"
 */

/**
 * @typedef {Object} AccuracyBreakdown
 * @property {number} overall              — 0–100
 * @property {{ [signalType: string]: TypeAccuracy }} bySignalType
 * @property {{ [velocity: string]: TypeAccuracy }}   byVelocity
 * @property {{ [confidence: string]: TypeAccuracy }}  byConfidence
 */

/**
 * @typedef {Object} TypeAccuracy
 * @property {number} total
 * @property {number} confirmed
 * @property {number} noise
 * @property {number} inconclusive
 * @property {number} rate          — confirmed / (confirmed + noise), 0–1
 * @property {string} direction     — "increase" | "decrease" | "neutral"
 */

/**
 * @typedef {Object} DimensionAnalysis
 * @property {string}  dimension     — e.g. "velocity", "signalType", "concentration"
 * @property {string}  finding       — human-readable observation
 * @property {string}  direction     — "increase" | "decrease" | "neutral"
 * @property {number}  confidence    — 0–1, how strong the signal is
 * @property {number}  sampleSize
 */

/**
 * @typedef {Object} WeightRecommendation
 * @property {string}  weightKey     — e.g. "BASE_WEIGHTS.velocity"
 * @property {number}  currentValue
 * @property {number}  recommendedValue
 * @property {number}  delta         — recommendedValue - currentValue
 * @property {string}  rationale
 * @property {string}  direction     — "increase" | "decrease" | "neutral"
 * @property {number}  confidence    — 0–1
 */

// ─── Persistence ──────────────────────────────────────────────────────────────

let _records = [];

function loadRecords() {
  try {
    if (fs.existsSync(FEEDBACK_CONFIG.recordsFile)) {
      _records = JSON.parse(fs.readFileSync(FEEDBACK_CONFIG.recordsFile, "utf-8"));
    }
  } catch (e) {
    console.warn("[feedback] Could not load learning records:", e.message);
    _records = [];
  }
}

function saveRecord(record) {
  try {
    if (!fs.existsSync(FEEDBACK_CONFIG.dataDir)) {
      fs.mkdirSync(FEEDBACK_CONFIG.dataDir, { recursive: true });
    }
    _records.unshift(record);
    if (_records.length > FEEDBACK_CONFIG.maxRecords) {
      _records = _records.slice(0, FEEDBACK_CONFIG.maxRecords);
    }
    fs.writeFileSync(FEEDBACK_CONFIG.recordsFile, JSON.stringify(_records, null, 2));
  } catch (e) {
    console.warn("[feedback] Could not save learning record:", e.message);
  }
}

loadRecords();

// ─── Subgroup accuracy ────────────────────────────────────────────────────────

/**
 * Group evaluations by a field and compute accuracy per group.
 *
 * @param {object[]} evaluations
 * @param {string}   field        — field on evaluation record to group by
 * @returns {{ [value: string]: TypeAccuracy }}
 */
function groupAccuracy(evaluations, field) {
  const groups = {};

  for (const e of evaluations) {
    const key = e[field] ?? "unknown";
    if (!groups[key]) groups[key] = { total: 0, confirmed: 0, noise: 0, inconclusive: 0 };
    groups[key].total++;
    groups[key][e.outcome]++;
  }

  for (const key of Object.keys(groups)) {
    const g       = groups[key];
    const decided = g.confirmed + g.noise;
    g.rate        = decided > 0 ? g.confirmed / decided : 0;
    g.direction   = rateToDirection(g.rate, g.total);
  }

  return groups;
}

function rateToDirection(rate, sampleSize) {
  if (sampleSize < FEEDBACK_CONFIG.minSubgroupSize) return "neutral"; // too small to trust
  if (rate >= FEEDBACK_CONFIG.strongPositiveThreshold) return "increase";
  if (rate >= FEEDBACK_CONFIG.weakPositiveThreshold)   return "increase";
  if (rate <= FEEDBACK_CONFIG.strongNegativeThreshold) return "decrease";
  if (rate <= FEEDBACK_CONFIG.weakNegativeThreshold)   return "decrease";
  return "neutral";
}

function directionConfidence(rate, sampleSize) {
  if (sampleSize < FEEDBACK_CONFIG.minSubgroupSize) return 0;

  // Distance from neutral (0.5) normalised to [0,1]
  const distFromNeutral = Math.abs(rate - 0.5) / 0.5;

  // Scale by sample size confidence (asymptotes to 1 at 50 samples)
  const sampleConfidence = Math.min(1, sampleSize / 50);

  return Math.round(distFromNeutral * sampleConfidence * 100) / 100;
}

// ─── Dimension analyses ───────────────────────────────────────────────────────

function analyseDimensions(evaluations) {
  const analyses = [];

  // ── Signal type analysis ────────────────────────────────────────────────────
  const byType = groupAccuracy(evaluations, "initialSignalType");

  for (const [type, stats] of Object.entries(byType)) {
    if (stats.total < FEEDBACK_CONFIG.minSubgroupSize) continue;
    const conf = directionConfidence(stats.rate, stats.total);
    analyses.push({
      dimension:  "signalType",
      subgroup:   type,
      finding:    `"${type}" signals confirmed at ${pct(stats.rate)} (${stats.total} evaluations).`,
      direction:  stats.direction,
      confidence: conf,
      sampleSize: stats.total,
      rate:       stats.rate,
    });
  }

  // ── Velocity analysis ────────────────────────────────────────────────────────
  const byVelocity = groupAccuracy(evaluations, "velocity");
  for (const [vel, stats] of Object.entries(byVelocity)) {
    if (stats.total < FEEDBACK_CONFIG.minSubgroupSize) continue;
    const conf = directionConfidence(stats.rate, stats.total);
    analyses.push({
      dimension:  "velocity",
      subgroup:   vel,
      finding:    `"${vel}" velocity confirmed at ${pct(stats.rate)} (${stats.total} evaluations).`,
      direction:  stats.direction,
      confidence: conf,
      sampleSize: stats.total,
      rate:       stats.rate,
    });
  }

  // ── Confidence level analysis ────────────────────────────────────────────────
  const byConfidence = groupAccuracy(evaluations, "initialConfidence");
  for (const [conf_, stats] of Object.entries(byConfidence)) {
    if (stats.total < FEEDBACK_CONFIG.minSubgroupSize) continue;
    const conf = directionConfidence(stats.rate, stats.total);
    analyses.push({
      dimension:  "confidence",
      subgroup:   conf_,
      finding:    `"${conf_}" confidence signals confirmed at ${pct(stats.rate)} (${stats.total} evaluations).`,
      direction:  stats.direction,
      confidence: conf,
      sampleSize: stats.total,
      rate:       stats.rate,
    });
  }

  // ── Score correlation analysis ───────────────────────────────────────────────
  // Split evaluations into high-score (>= 65) and low-score (< 65) groups
  const highScore = evaluations.filter(e => (e.initialScore ?? 0) >= 65);
  const lowScore  = evaluations.filter(e => (e.initialScore ?? 0) <  65);

  for (const [label, group] of [["high (≥65)", highScore], ["low (<65)", lowScore]]) {
    if (group.length < FEEDBACK_CONFIG.minSubgroupSize) continue;
    const decided = group.filter(e => e.outcome !== "inconclusive");
    const confirmedCount = decided.filter(e => e.outcome === "confirmed").length;
    const rate = decided.length > 0 ? confirmedCount / decided.length : 0;
    const conf = directionConfidence(rate, group.length);
    analyses.push({
      dimension:  "scoreLevel",
      subgroup:   label,
      finding:    `${label}-score signals confirmed at ${pct(rate)} (${group.length} evaluations).`,
      direction:  rateToDirection(rate, group.length),
      confidence: conf,
      sampleSize: group.length,
      rate,
    });
  }

  return analyses;
}

// ─── Weight recommendations ───────────────────────────────────────────────────

/**
 * Generate weight adjustment recommendations from dimension analyses.
 * Never exceeds ±maxAdjustmentFraction of current weight per cycle.
 * Weights must remain positive after adjustment.
 *
 * @param {DimensionAnalysis[]} analyses
 * @returns {WeightRecommendation[]}
 */
function generateRecommendations(analyses) {
  const recommendations = [];
  const cfg = FEEDBACK_CONFIG;

  // ── Velocity weight ──────────────────────────────────────────────────────────
  const velocityAnalyses = analyses.filter(a => a.dimension === "velocity");
  const highVel = velocityAnalyses.find(a => a.subgroup === "high");
  const lowVel  = velocityAnalyses.find(a => a.subgroup === "low");

  if (highVel && lowVel && highVel.confidence > 0.3) {
    const rateDiff  = (highVel.rate ?? 0) - (lowVel.rate ?? 0);
    const direction = rateDiff > 0.1 ? "increase" : rateDiff < -0.1 ? "decrease" : "neutral";
    if (direction !== "neutral") {
      const delta = computeDelta(BASE_WEIGHTS.velocity, direction, highVel.confidence);
      recommendations.push({
        weightKey:        "BASE_WEIGHTS.velocity",
        currentValue:     BASE_WEIGHTS.velocity,
        recommendedValue: clampWeight(BASE_WEIGHTS.velocity + delta),
        delta:            round3(delta),
        rationale:        `High-velocity signals confirm at ${pct(highVel.rate)} vs low-velocity at ${pct(lowVel.rate)}. Rate diff: ${pct(rateDiff)}.`,
        direction,
        confidence:       highVel.confidence,
      });
    }
  }

  // ── Theme weight ─────────────────────────────────────────────────────────────
  // Proxy: thesis signals (which use theme context) vs hype signals (which don't)
  const thesisAnalysis = analyses.find(a => a.dimension === "signalType" && a.subgroup === "thesis");
  const hypeAnalysis   = analyses.find(a => a.dimension === "signalType" && a.subgroup === "hype");

  if (thesisAnalysis && hypeAnalysis && thesisAnalysis.confidence > 0.3) {
    const rateDiff  = (thesisAnalysis.rate ?? 0) - (hypeAnalysis.rate ?? 0);
    const direction = rateDiff > 0.15 ? "increase" : rateDiff < -0.15 ? "decrease" : "neutral";
    if (direction !== "neutral") {
      const delta = computeDelta(BASE_WEIGHTS.theme, direction, thesisAnalysis.confidence);
      recommendations.push({
        weightKey:        "BASE_WEIGHTS.theme",
        currentValue:     BASE_WEIGHTS.theme,
        recommendedValue: clampWeight(BASE_WEIGHTS.theme + delta),
        delta:            round3(delta),
        rationale:        `Thesis (theme-associated) signals confirm at ${pct(thesisAnalysis.rate)} vs hype at ${pct(hypeAnalysis.rate)}.`,
        direction,
        confidence:       thesisAnalysis.confidence,
      });
    }
  }

  // ── Mentions weight ──────────────────────────────────────────────────────────
  // If high-score signals (which weight mentions heavily) aren't confirming
  // better than low-score, mentions may be overweighted
  const highScore = analyses.find(a => a.dimension === "scoreLevel" && a.subgroup.startsWith("high"));
  const lowScore  = analyses.find(a => a.dimension === "scoreLevel" && a.subgroup.startsWith("low"));

  if (highScore && lowScore && highScore.confidence > 0.3) {
    const rateDiff  = (highScore.rate ?? 0) - (lowScore.rate ?? 0);
    // Only recommend change if high scores aren't doing meaningfully better
    if (rateDiff < 0.05) {
      const delta = computeDelta(BASE_WEIGHTS.mentions, "decrease", highScore.confidence * 0.5);
      recommendations.push({
        weightKey:        "BASE_WEIGHTS.mentions",
        currentValue:     BASE_WEIGHTS.mentions,
        recommendedValue: clampWeight(BASE_WEIGHTS.mentions + delta),
        delta:            round3(delta),
        rationale:        `High-score signals confirm at only ${pct(rateDiff)} more than low-score. Mentions weight may be over-indexed.`,
        direction:        "decrease",
        confidence:       highScore.confidence * 0.5,
      });
    }
  }

  // ── Consistency modifier ─────────────────────────────────────────────────────
  // Look at the correlation between velocity ("high" = consistent attention)
  // and confirmation rate to assess whether the consistency modifier is calibrated
  if (highVel && highVel.rate > 0.6 && highVel.confidence > 0.4) {
    const delta = computeDelta(MODIFIER_WEIGHTS.consistency, "increase", highVel.confidence);
    if (Math.abs(delta) >= 0.005) {
      recommendations.push({
        weightKey:        "MODIFIER_WEIGHTS.consistency",
        currentValue:     MODIFIER_WEIGHTS.consistency,
        recommendedValue: clampWeight(MODIFIER_WEIGHTS.consistency + delta, 0.05, 0.30),
        delta:            round3(delta),
        rationale:        `High-velocity signals confirm at ${pct(highVel.rate)}. Consistency modifier may be underweighted.`,
        direction:        "increase",
        confidence:       highVel.confidence,
      });
    }
  }

  return recommendations.filter(r => Math.abs(r.delta) >= 0.005); // drop negligible changes
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeDelta(currentWeight, direction, confidence) {
  const maxDelta  = currentWeight * FEEDBACK_CONFIG.maxAdjustmentFraction;
  const magnitude = maxDelta * Math.min(1, confidence);
  return direction === "increase" ? magnitude : -magnitude;
}

function clampWeight(value, min = 0.05, max = 0.70) {
  return round3(Math.max(min, Math.min(max, value)));
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function pct(r)    { return `${Math.round((r ?? 0) * 100)}%`; }

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run one feedback cycle.
 * Reads all evaluation outcomes, analyses them, and logs a LearningRecord.
 *
 * @param {object} options
 * @param {number} options.limitEvals — max evaluations to analyse (default: all)
 * @returns {LearningRecord}
 */
export function runFeedbackCycle(options = {}) {
  const evaluations = getAllEvaluations(options.limitEvals ?? 10000);

  // ── Insufficient data guard ─────────────────────────────────────────────────
  if (evaluations.length < FEEDBACK_CONFIG.minEvaluations) {
    const record = {
      recordId:             `lr_${Date.now()}`,
      generatedAt:          Date.now(),
      evaluationsAnalyzed:  evaluations.length,
      windowDays:           0,
      hasEnoughData:        false,
      accuracyBreakdown:    null,
      dimensionAnalyses:    [],
      recommendations:      [],
      summary:              `Insufficient data: ${evaluations.length}/${FEEDBACK_CONFIG.minEvaluations} minimum evaluations.`,
      status:               "insufficient_data",
    };
    saveRecord(record);
    console.log(`[feedback] ${record.summary}`);
    return record;
  }

  // ── Accuracy breakdown ──────────────────────────────────────────────────────
  const stats = getAccuracyStats();
  const overallBreakdown = {
    overall:        stats.accuracy ?? 0,
    bySignalType:   groupAccuracy(evaluations, "initialSignalType"),
    byVelocity:     groupAccuracy(evaluations, "velocity"),
    byConfidence:   groupAccuracy(evaluations, "initialConfidence"),
  };

  // ── Dimension analyses ──────────────────────────────────────────────────────
  const dimensionAnalyses = analyseDimensions(evaluations);

  // ── Weight recommendations ──────────────────────────────────────────────────
  const recommendations = generateRecommendations(dimensionAnalyses);

  // ── Window span ─────────────────────────────────────────────────────────────
  const timestamps = evaluations.map(e => e.evaluatedAt).filter(Boolean);
  const spanMs     = timestamps.length >= 2
    ? Math.max(...timestamps) - Math.min(...timestamps)
    : 0;
  const windowDays = Math.round(spanMs / (24 * 3600 * 1000) * 10) / 10;

  // ── Status ──────────────────────────────────────────────────────────────────
  const actionable = recommendations.filter(r => r.confidence > 0.4).length;
  const status     = actionable > 0 ? "actionable"
    : dimensionAnalyses.length > 0  ? "stable"
    : "insufficient_data";

  // ── Summary ─────────────────────────────────────────────────────────────────
  const topRec = recommendations.sort((a, b) => b.confidence - a.confidence)[0];
  const summary = topRec
    ? `${evaluations.length} evals over ${windowDays}d. Overall: ${stats.accuracy}%. Top recommendation: ${topRec.direction} ${topRec.weightKey} by ${(Math.abs(topRec.delta) * 100).toFixed(1)}% (confidence: ${pct(topRec.confidence)}).`
    : `${evaluations.length} evals over ${windowDays}d. Overall accuracy: ${stats.accuracy}%. No weight adjustments recommended at this time.`;

  const record = {
    recordId:            `lr_${Date.now()}`,
    generatedAt:         Date.now(),
    evaluationsAnalyzed: evaluations.length,
    windowDays,
    hasEnoughData:       true,
    accuracyBreakdown:   overallBreakdown,
    dimensionAnalyses,
    recommendations,
    summary,
    status,
  };

  saveRecord(record);

  console.log(`[feedback] ${record.summary}`);
  if (recommendations.length > 0) {
    for (const r of recommendations) {
      console.log(`  → ${r.weightKey}: ${r.currentValue} → ${r.recommendedValue} (${r.direction}, conf: ${pct(r.confidence)})`);
    }
  }

  return record;
}

// ─── Read access ──────────────────────────────────────────────────────────────

export function getLearningRecords(limit = 20) {
  return _records.slice(0, limit);
}

export function getLatestLearningRecord() {
  return _records[0] ?? null;
}

/**
 * Format the latest recommendations as a human-readable change proposal.
 * This is what a developer would review before applying weight changes.
 */
export function formatRecommendations() {
  const latest = getLatestLearningRecord();
  if (!latest || !latest.recommendations?.length) {
    return "No pending recommendations.";
  }

  const lines = [
    `Learning record: ${latest.recordId} (${new Date(latest.generatedAt).toLocaleDateString()})`,
    `Based on: ${latest.evaluationsAnalyzed} evaluations over ${latest.windowDays} days`,
    `Overall accuracy: ${latest.accuracyBreakdown?.overall ?? "?"}%`,
    "",
    "RECOMMENDED WEIGHT CHANGES (apply manually to prioritize.js):",
    "─────────────────────────────────────────────────────────",
  ];

  for (const r of latest.recommendations) {
    lines.push(
      `  ${r.weightKey}`,
      `    Current:     ${r.currentValue}`,
      `    Recommended: ${r.recommendedValue}  (${r.direction} by ${(Math.abs(r.delta) * 100).toFixed(1)}%)`,
      `    Confidence:  ${pct(r.confidence)}`,
      `    Rationale:   ${r.rationale}`,
      "",
    );
  }

  lines.push("Apply changes by editing BASE_WEIGHTS / MODIFIER_WEIGHTS in prioritize.js.");
  lines.push("Run the test suite after applying to ensure weights still sum to 1.0.");

  return lines.join("\n");
}
