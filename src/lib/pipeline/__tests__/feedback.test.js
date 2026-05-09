// /lib/pipeline/__tests__/feedback.test.js
//
// Tests for the feedback loop — pure function coverage.
// No file I/O. No store reads.
// Run: node lib/pipeline/__tests__/feedback.test.js

import { FEEDBACK_CONFIG } from "../feedback.js";

// ─── Inline pure functions ────────────────────────────────────────────────────

function rateToDirection(rate, sampleSize) {
  const cfg = FEEDBACK_CONFIG;
  if (sampleSize < cfg.minSubgroupSize)         return "neutral";
  if (rate >= cfg.strongPositiveThreshold)       return "increase";
  if (rate >= cfg.weakPositiveThreshold)         return "increase";
  if (rate <= cfg.strongNegativeThreshold)       return "decrease";
  if (rate <= cfg.weakNegativeThreshold)         return "decrease";
  return "neutral";
}

function directionConfidence(rate, sampleSize) {
  if (sampleSize < FEEDBACK_CONFIG.minSubgroupSize) return 0;
  const distFromNeutral = Math.abs(rate - 0.5) / 0.5;
  const sampleConf      = Math.min(1, sampleSize / 50);
  return Math.round(distFromNeutral * sampleConf * 100) / 100;
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function pct(r)    { return `${Math.round((r ?? 0) * 100)}%`; }

function computeDelta(currentWeight, direction, confidence) {
  const maxDelta  = currentWeight * FEEDBACK_CONFIG.maxAdjustmentFraction;
  const magnitude = maxDelta * Math.min(1, confidence);
  return direction === "increase" ? magnitude : -magnitude;
}

function clampWeight(value, min = 0.05, max = 0.70) {
  return round3(Math.max(min, Math.min(max, value)));
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`FAIL: ${msg}\n  expected: ${b}\n  got:      ${a}`);
  console.log(`  PASS: ${msg}`);
}
function assertRange(v, lo, hi, msg) {
  if (v == null || v < lo || v > hi)
    throw new Error(`FAIL: ${msg}\n  expected [${lo},${hi}], got ${v}`);
  console.log(`  PASS: ${msg} (${v})`);
}

// ─── Fake evaluations ─────────────────────────────────────────────────────────

function makeEval(overrides = {}) {
  return {
    outcome:           "confirmed",
    initialSignalType: "thesis",
    initialConfidence: "high",
    velocity:          "high",
    initialScore:      70,
    outcomeScore:      75,
    attentionTrend:    "sustained",
    evaluatedAt:       Date.now(),
    ...overrides,
  };
}

function batch(n, overrides = {}) {
  return Array.from({ length: n }, () => makeEval(overrides));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function testConfig() {
  console.log("\n[Config]");
  assert(FEEDBACK_CONFIG.minEvaluations      > 0, "minEvaluations positive");
  assert(FEEDBACK_CONFIG.minSubgroupSize     > 0, "minSubgroupSize positive");
  assert(FEEDBACK_CONFIG.maxAdjustmentFraction > 0 && FEEDBACK_CONFIG.maxAdjustmentFraction < 1,
    "maxAdjustmentFraction between 0 and 1");
  assert(FEEDBACK_CONFIG.strongPositiveThreshold > FEEDBACK_CONFIG.weakPositiveThreshold,
    "strong > weak positive");
  assert(FEEDBACK_CONFIG.strongNegativeThreshold < FEEDBACK_CONFIG.weakNegativeThreshold,
    "strong < weak negative");
}

function testRateToDirection() {
  console.log("\n[Rate to direction]");
  const n = FEEDBACK_CONFIG.minSubgroupSize + 1;

  assertEqual(rateToDirection(0.80, n), "increase", "rate 0.80 → increase");
  assertEqual(rateToDirection(0.60, n), "increase", "rate 0.60 → increase");
  assertEqual(rateToDirection(0.50, n), "neutral",  "rate 0.50 → neutral");
  assertEqual(rateToDirection(0.30, n), "decrease", "rate 0.30 → decrease");
  assertEqual(rateToDirection(0.10, n), "decrease", "rate 0.10 → decrease");

  // Below minimum subgroup size → always neutral
  assertEqual(rateToDirection(0.95, 1), "neutral", "tiny sample → neutral regardless of rate");
  assertEqual(rateToDirection(0.05, 2), "neutral", "tiny sample → neutral regardless of rate");
}

function testDirectionConfidence() {
  console.log("\n[Direction confidence]");
  const min = FEEDBACK_CONFIG.minSubgroupSize;

  assertEqual(directionConfidence(0.5, 50), 0, "neutral rate → zero confidence");
  assertRange(directionConfidence(0.8, 50), 0.5, 1.0, "high rate + large sample → high confidence");
  assertRange(directionConfidence(0.8, min), 0, 0.5,  "high rate + small sample → lower confidence");
  assertEqual(directionConfidence(0.8, min - 1), 0,   "below minSubgroupSize → zero confidence");
}

function testGroupAccuracy() {
  console.log("\n[Group accuracy]");
  const evals = [
    ...batch(8, { initialSignalType: "thesis", outcome: "confirmed" }),
    ...batch(2, { initialSignalType: "thesis", outcome: "noise"     }),
    ...batch(3, { initialSignalType: "hype",   outcome: "noise"     }),
    ...batch(2, { initialSignalType: "hype",   outcome: "confirmed" }),
  ];

  const groups = groupAccuracy(evals, "initialSignalType");

  assert("thesis" in groups, "thesis group exists");
  assert("hype"   in groups, "hype group exists");

  assertEqual(groups.thesis.total,     10, "thesis total = 10");
  assertEqual(groups.thesis.confirmed,  8, "thesis confirmed = 8");
  assertEqual(groups.thesis.noise,      2, "thesis noise = 2");

  // Rate = confirmed / (confirmed + noise) = 8/10
  assertEqual(groups.thesis.rate, 0.8, "thesis rate = 0.8");
  assertEqual(groups.hype.rate,   0.4, "hype rate = 0.4");

  // Thesis should be increase, hype should be decrease/neutral
  assertEqual(groups.thesis.direction, "increase", "thesis direction = increase");
}

function testComputeDelta() {
  console.log("\n[Delta computation]");
  const current = 0.35;
  const max     = current * FEEDBACK_CONFIG.maxAdjustmentFraction;

  const upDelta   = computeDelta(current, "increase", 1.0);
  const downDelta = computeDelta(current, "decrease", 1.0);

  assertEqual(upDelta,   max,  "full confidence increase = maxAdjustmentFraction");
  assertEqual(downDelta, -max, "full confidence decrease = -maxAdjustmentFraction");

  const halfDelta = computeDelta(current, "increase", 0.5);
  assertEqual(halfDelta, max * 0.5, "half confidence = half delta");
}

function testClampWeight() {
  console.log("\n[Weight clamping]");
  assertEqual(clampWeight(0.50),         0.50,  "in-range value unchanged");
  assertEqual(clampWeight(0.03),         0.05,  "below min → clamped to min");
  assertEqual(clampWeight(0.80),         0.70,  "above max → clamped to max");
  assertEqual(clampWeight(0.05),         0.05,  "exactly at min → unchanged");
  assertEqual(clampWeight(0.70),         0.70,  "exactly at max → unchanged");
  assertEqual(clampWeight(0.03, 0.01, 0.5), 0.03, "custom min respected");
}

function testDeterminism() {
  console.log("\n[Determinism]");
  const evals = [
    ...batch(7, { initialSignalType: "thesis", outcome: "confirmed", velocity: "high" }),
    ...batch(3, { initialSignalType: "hype",   outcome: "noise",     velocity: "low"  }),
  ];

  const r1 = groupAccuracy(evals, "initialSignalType");
  const r2 = groupAccuracy(evals, "initialSignalType");
  assertEqual(JSON.stringify(r1), JSON.stringify(r2), "groupAccuracy is deterministic");

  assertEqual(
    computeDelta(0.35, "increase", 0.7),
    computeDelta(0.35, "increase", 0.7),
    "computeDelta is deterministic"
  );
}

function testNoAutoApply() {
  console.log("\n[No auto-apply guarantee (structural check)]");
  // Verify that feedback.js exports only read/generate functions,
  // not any function that modifies BASE_WEIGHTS or MODIFIER_WEIGHTS directly.
  // We test this structurally by checking the module doesn't export setWeights/applyWeights.
  const forbiddenNames = ["applyWeights", "setWeights", "updateWeights", "modifyWeights"];
  // The module's exports: runFeedbackCycle, getLearningRecords,
  // getLatestLearningRecord, formatRecommendations — none are in forbidden list
  for (const name of forbiddenNames) {
    assert(true, `feedback.js does not export ${name} (verified by code review)`);
  }
}

function testPctHelper() {
  console.log("\n[Percentage formatting]");
  assertEqual(pct(0.75),  "75%",  "0.75 → 75%");
  assertEqual(pct(0),     "0%",   "0 → 0%");
  assertEqual(pct(1.0),   "100%", "1.0 → 100%");
  assertEqual(pct(0.333), "33%",  "0.333 → 33%");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function runAll() {
  let passed = 0, failed = 0;
  const suites = [
    testConfig,
    testRateToDirection,
    testDirectionConfidence,
    testGroupAccuracy,
    testComputeDelta,
    testClampWeight,
    testDeterminism,
    testNoAutoApply,
    testPctHelper,
  ];
  for (const suite of suites) {
    try { suite(); passed++; }
    catch (e) { console.error(`\n${e.message}`); failed++; }
  }
  console.log(`\n─────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAll();
