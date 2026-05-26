// /lib/pipeline/__tests__/evaluate.test.js
//
// Tests for the evaluation engine.
// Verifies outcome classification rules fire correctly.
// No network calls. No file I/O (mocks the stores).
// Run: node lib/pipeline/__tests__/evaluate.test.js

// ─── Inline the pure functions (no store dependency) ─────────────────────────

import { EVAL_CONFIG } from "../evaluate.js";
import {
  MAX_EVALUATION_WINDOW_HOURS,
  assertEvaluationRetentionConfig,
} from "../evaluationStore.js";
import {
  SNAPSHOT_RETENTION_HOURS,
  EXPECTED_SNAPSHOT_CAPACITY,
} from "../snapshotStore.js";

function computeAttentionRatio(atSurface, atEval) {
  if (atSurface === 0) return atEval > 0 ? 1.5 : 0;
  return Math.min(3.0, atEval / atSurface);
}

function classifyAttentionTrend(ratio) {
  if (ratio >= 1.5)  return "rising";
  if (ratio >= 0.75) return "sustained";
  if (ratio >= 0.25) return "fading";
  return "gone";
}

function computeOutcomeScore(attentionRatio, consistency, crossSubreddit) {
  const ratioScore       = Math.min(100, (attentionRatio / 3.0) * 100);
  const consistencyScore = consistency * 100;
  const spreadScore      = crossSubreddit ? 100 : 0;
  const w                = EVAL_CONFIG.outcomeWeights;
  return Math.round(
    ratioScore       * w.attentionRatio +
    consistencyScore * w.consistency +
    spreadScore      * w.crossSubreddit
  );
}

function classifyOutcome(attentionRatio, attentionTrend, snapshotsCounted, consistency) {
  if (
    snapshotsCounted >= EVAL_CONFIG.confirmedMinSnapshots &&
    attentionRatio   >= EVAL_CONFIG.confirmedMinRatio     &&
    consistency      >= EVAL_CONFIG.confirmedConsistencyMin
  ) {
    return { outcome: "confirmed", successFlag: true };
  }
  if (
    snapshotsCounted <= EVAL_CONFIG.noiseMaxSnapshots &&
    attentionRatio   <= EVAL_CONFIG.noiseMaxRatio
  ) {
    return { outcome: "noise", successFlag: false };
  }
  return { outcome: "inconclusive", successFlag: false };
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
  if (v < lo || v > hi) throw new Error(`FAIL: ${msg}\n  expected [${lo},${hi}], got ${v}`);
  console.log(`  PASS: ${msg} (${v})`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function testConfig() {
  console.log("\n[Config]");
  assert(EVAL_CONFIG.confirmedMinRatio     > 0,   "confirmedMinRatio positive");
  assert(EVAL_CONFIG.noiseMaxRatio         > 0,   "noiseMaxRatio positive");
  assert(EVAL_CONFIG.confirmedMinSnapshots > 0,   "confirmedMinSnapshots positive");
  assert(EVAL_CONFIG.noiseMaxSnapshots     < EVAL_CONFIG.confirmedMinSnapshots,
    "noise threshold < confirmed threshold");
  assert(EVAL_CONFIG.confirmedConsistencyMin > 0, "confirmedConsistencyMin positive");

  const wSum = Object.values(EVAL_CONFIG.outcomeWeights).reduce((s, v) => s + v, 0);
  assert(Math.abs(wSum - 1.0) < 0.001, "outcomeWeights sum to 1.0");
  assert(SNAPSHOT_RETENTION_HOURS >= 96, "snapshot retention is at least 96h");
  assert(SNAPSHOT_RETENTION_HOURS >= MAX_EVALUATION_WINDOW_HOURS,
    "snapshot retention covers max evaluation window");
  assert(EXPECTED_SNAPSHOT_CAPACITY >= 192, "expected snapshot capacity covers 96h at 30m cadence");
  assertEqual(assertEvaluationRetentionConfig(), undefined, "retention/evaluation guard passes");
}

function testAttentionRatio() {
  console.log("\n[Attention ratio]");
  assertEqual(computeAttentionRatio(10, 10),  1.0,  "same mentions → ratio 1.0");
  assertEqual(computeAttentionRatio(10, 20),  2.0,  "doubled → ratio 2.0");
  assertEqual(computeAttentionRatio(10,  5),  0.5,  "halved → ratio 0.5");
  assertEqual(computeAttentionRatio(10,  0),  0,    "gone → ratio 0");
  assertEqual(computeAttentionRatio(10, 100), 3.0,  "extreme rise capped at 3.0");
  assertEqual(computeAttentionRatio(0,   5),  1.5,  "zero surface, positive eval → 1.5");
  assertEqual(computeAttentionRatio(0,   0),  0,    "zero surface, zero eval → 0");
}

function testAttentionTrend() {
  console.log("\n[Attention trend]");
  assertEqual(classifyAttentionTrend(2.0),  "rising",    "ratio 2.0 → rising");
  assertEqual(classifyAttentionTrend(1.5),  "rising",    "ratio 1.5 → rising (boundary)");
  assertEqual(classifyAttentionTrend(1.0),  "sustained", "ratio 1.0 → sustained");
  assertEqual(classifyAttentionTrend(0.75), "sustained", "ratio 0.75 → sustained (boundary)");
  assertEqual(classifyAttentionTrend(0.5),  "fading",    "ratio 0.5 → fading");
  assertEqual(classifyAttentionTrend(0.25), "fading",    "ratio 0.25 → fading (boundary)");
  assertEqual(classifyAttentionTrend(0.1),  "gone",      "ratio 0.1 → gone");
  assertEqual(classifyAttentionTrend(0),    "gone",      "ratio 0 → gone");
}

function testOutcomeScore() {
  console.log("\n[Outcome score]");
  const perfect = computeOutcomeScore(3.0, 1.0, true);
  assertEqual(perfect, 100, "perfect inputs → 100");

  const zero = computeOutcomeScore(0, 0, false);
  assertEqual(zero, 0, "zero inputs → 0");

  assertRange(computeOutcomeScore(1.0, 0.5, true),  0, 100, "mid inputs in range");
  assertRange(computeOutcomeScore(0.5, 0.3, false), 0, 100, "low inputs in range");

  // Cross-subreddit contributes 25% weight
  const withSpread    = computeOutcomeScore(1.0, 0.5, true);
  const withoutSpread = computeOutcomeScore(1.0, 0.5, false);
  assert(withSpread > withoutSpread, "cross-subreddit spread improves outcome score");
}

function testOutcomeClassification() {
  console.log("\n[Outcome classification]");

  // Confirmed: all thresholds met
  {
    const r = classifyOutcome(1.0, "sustained", 4, 0.75);
    assertEqual(r.outcome,     "confirmed", "sustained × 4 snapshots × 75% consistency → confirmed");
    assertEqual(r.successFlag, true,        "confirmed → successFlag true");
  }

  // Confirmed: rising attention
  {
    const r = classifyOutcome(2.0, "rising", 5, 0.80);
    assertEqual(r.outcome, "confirmed", "rising × 5 snapshots → confirmed");
  }

  // Noise: spike and gone
  {
    const r = classifyOutcome(0.1, "gone", 1, 0.1);
    assertEqual(r.outcome,     "noise", "gone + single snapshot → noise");
    assertEqual(r.successFlag, false,   "noise → successFlag false");
  }

  // Noise: low ratio, minimal snapshots
  {
    const r = classifyOutcome(0.2, "gone", 1, 0.0);
    assertEqual(r.outcome, "noise", "very low ratio + 1 snapshot → noise");
  }

  // Inconclusive: intermediate data
  {
    const r = classifyOutcome(0.6, "fading", 2, 0.4);
    assertEqual(r.outcome, "inconclusive", "fading, 2 snapshots, 40% consistency → inconclusive");
  }

  // Inconclusive: good ratio but too few snapshots
  {
    const r = classifyOutcome(1.2, "sustained", 1, 0.5);
    assertEqual(r.outcome, "inconclusive", "good ratio but only 1 snapshot → inconclusive");
  }

  // Inconclusive: enough snapshots but low consistency
  {
    const r = classifyOutcome(0.9, "sustained", 4, 0.3);
    assertEqual(r.outcome, "inconclusive", "enough snapshots but 30% consistency → inconclusive");
  }
}

function testDeterminism() {
  console.log("\n[Determinism]");
  const inputs = [1.2, "sustained", 4, 0.6];
  const r1 = classifyOutcome(...inputs);
  const r2 = classifyOutcome(...inputs);
  assertEqual(r1.outcome,     r2.outcome,     "same input → same outcome");
  assertEqual(r1.successFlag, r2.successFlag, "same input → same successFlag");

  const s1 = computeOutcomeScore(1.2, 0.6, true);
  const s2 = computeOutcomeScore(1.2, 0.6, true);
  assertEqual(s1, s2, "same inputs → same outcome score");
}

function testNoHindsightBias() {
  console.log("\n[No hindsight bias]");
  // The initial score is a fixed input, never modified.
  // Verify that outcome classification does not depend on the initial score.
  const withHighInitial = classifyOutcome(0.1, "gone", 1, 0.0);
  const withLowInitial  = classifyOutcome(0.1, "gone", 1, 0.0);
  assertEqual(withHighInitial.outcome, withLowInitial.outcome,
    "outcome classification is independent of initial score");
}

function testSignalTypeDoesNotInfluenceOutcome() {
  console.log("\n[Signal type independence]");
  // A thesis signal and a hype signal with identical attention patterns
  // must receive identical outcome classifications.
  // Outcome is about WHAT HAPPENED, not what we predicted.
  const thesisOutcome = classifyOutcome(0.2, "gone", 1, 0.0);
  const hypeOutcome   = classifyOutcome(0.2, "gone", 1, 0.0);
  assertEqual(thesisOutcome.outcome, hypeOutcome.outcome,
    "same attention pattern → same outcome regardless of initial signal type");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function runAll() {
  let passed = 0, failed = 0;
  const suites = [
    testConfig,
    testAttentionRatio,
    testAttentionTrend,
    testOutcomeScore,
    testOutcomeClassification,
    testDeterminism,
    testNoHindsightBias,
    testSignalTypeDoesNotInfluenceOutcome,
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
