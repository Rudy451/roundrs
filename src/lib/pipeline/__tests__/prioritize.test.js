// /lib/pipeline/__tests__/prioritize.test.js
//
// Tests for the v2 signal scoring model.
// No network calls. Pure function verification.
// Run: node lib/pipeline/__tests__/prioritize.test.js

import {
  prioritizeSignals,
  BASE_WEIGHTS,
  MODIFIER_WEIGHTS,
  PENALTY_CAPS,
  summarizePrioritization,
} from "../prioritize.js";

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
function assertGte(a, b, msg) {
  if (a < b) throw new Error(`FAIL: ${msg}\n  expected ≥ ${b}, got ${a}`);
  console.log(`  PASS: ${msg}`);
}

const nowS = Math.floor(Date.now() / 1000);

function sig(ticker, mentions, overrides = {}) {
  return {
    ticker,
    mentions,
    velocity:         "medium",
    avgUpvotes:       400,
    lastSeen:         nowS * 1000,
    samplePosts:      [],
    postCount:        mentions,
    uniqueSubreddits: ["stocks"],
    mentionTimes:     Array.from({ length: mentions }, (_, i) => nowS - i * 3600),
    bodyLengths:      Array.from({ length: mentions }, () => 200),
    engagementRatios: Array.from({ length: mentions }, () => 0.3),
    ...overrides,
  };
}

// ─── Test suites ──────────────────────────────────────────────────────────────

function testWeights() {
  console.log("\n[Weights]");
  const baseSum = Object.values(BASE_WEIGHTS).reduce((s, v) => s + v, 0);
  assert(Math.abs(baseSum - 1.0) < 0.001, "BASE_WEIGHTS sum to 1.0");
  for (const [k, v] of Object.entries(MODIFIER_WEIGHTS)) {
    assert(v > 0 && v < 1, `MODIFIER_WEIGHTS.${k} is between 0 and 1`);
  }
  for (const [k, v] of Object.entries(PENALTY_CAPS)) {
    assert(v > 0, `PENALTY_CAPS.${k} is positive`);
  }
}

function testOutputShape() {
  console.log("\n[Output shape]");
  const ranked = prioritizeSignals([sig("NVDA", 5)]);
  assertEqual(ranked.length, 1, "output has one entry");
  const r = ranked[0];
  for (const field of ["ticker","baseScore","concentrationScore","consistencyScore",
                        "qualityScore","penaltyAdjustment","finalScore","totalScore",
                        "mentions","samplePosts","_components"]) {
    assert(field in r, `has field: ${field}`);
  }
  assertEqual(r.totalScore, r.finalScore, "totalScore aliases finalScore");
}

function testScoreRanges() {
  console.log("\n[Score ranges]");
  const signals = [
    sig("NVDA", 15, { uniqueSubreddits: ["stocks","wallstreetbets","investing"] }),
    sig("GME",  8),
    sig("CELH", 2),
  ];
  const ranked = prioritizeSignals(signals);
  for (const r of ranked) {
    assertRange(r.baseScore,          0, 100, `${r.ticker} baseScore`);
    assertRange(r.concentrationScore, 0, 100, `${r.ticker} concentrationScore`);
    assertRange(r.consistencyScore,   0, 100, `${r.ticker} consistencyScore`);
    assertRange(r.qualityScore,       0, 100, `${r.ticker} qualityScore`);
    assert(r.penaltyAdjustment <= 0,          `${r.ticker} penalty ≤ 0`);
    assertRange(r.finalScore,         0, 100, `${r.ticker} finalScore`);
  }
}

function testDeterminism() {
  console.log("\n[Determinism]");
  const signals = [sig("NVDA",10), sig("AMD",7), sig("TSLA",4)];
  const r1 = prioritizeSignals(signals).map(r => `${r.ticker}:${r.finalScore}`);
  const r2 = prioritizeSignals(signals).map(r => `${r.ticker}:${r.finalScore}`);
  assertEqual(JSON.stringify(r1), JSON.stringify(r2), "same input → same output");
}

function testSortOrder() {
  console.log("\n[Sort order]");
  const ranked = prioritizeSignals([sig("A",15), sig("B",3), sig("C",9)]);
  for (let i = 1; i < ranked.length; i++) {
    assert(ranked[i].finalScore <= ranked[i-1].finalScore,
      `rank ${i+1} (${ranked[i].finalScore}) ≤ rank ${i} (${ranked[i-1].finalScore})`);
  }
}

function testTieBreakerAlphabetical() {
  console.log("\n[Tie breaking]");
  // Identical inputs → alphabetical order
  const signals = [sig("TSLA",5), sig("AAPL",5), sig("NVDA",5)];
  const ranked  = prioritizeSignals(signals);
  const tickers = ranked.map(r => r.ticker);
  assertEqual(JSON.stringify(tickers), JSON.stringify([...tickers].sort()),
    "ties broken alphabetically");
}

function testConcentrationBoost() {
  console.log("\n[Concentration: spread boosts score]");
  const narrow = sig("X", 5, { uniqueSubreddits: ["wallstreetbets"] });
  const broad  = sig("Y", 5, { uniqueSubreddits: ["stocks","wallstreetbets","investing"] });
  const ranked = prioritizeSignals([narrow, broad]);
  assertGte(
    ranked.find(r => r.ticker === "Y").concentrationScore,
    ranked.find(r => r.ticker === "X").concentrationScore,
    "multi-subreddit ticker has higher concentrationScore"
  );
}

function testConsistencyVsSpike() {
  console.log("\n[Consistency: steady beats spike]");

  // Steady: spread evenly over 6 hours
  const steadyTimes = Array.from({ length: 6 }, (_, i) => nowS - i * 3600);

  // Spike: all 6 mentions in 10 minutes
  const spikeTimes  = Array.from({ length: 6 }, (_, i) => nowS - i * 100);

  const steady = sig("STEADY", 6, { mentionTimes: steadyTimes });
  const spike  = sig("SPIKE",  6, { mentionTimes: spikeTimes });
  const ranked = prioritizeSignals([steady, spike]);

  assertGte(
    ranked.find(r => r.ticker === "STEADY").consistencyScore,
    ranked.find(r => r.ticker === "SPIKE").consistencyScore,
    "steady spread has higher consistencyScore than spike"
  );
}

function testSpikePenalty() {
  console.log("\n[Spike penalty]");

  // 10 mentions all within 15 minutes
  const spikeTimes = Array.from({ length: 10 }, (_, i) => nowS - i * 90);
  const spiked = sig("SPIKED", 10, {
    mentionTimes:     spikeTimes,
    bodyLengths:      Array(10).fill(30),
    engagementRatios: Array(10).fill(0.01),
  });
  const clean = sig("CLEAN", 10); // even spread, decent body length

  const ranked = prioritizeSignals([spiked, clean]);
  assert(
    ranked.find(r => r.ticker === "SPIKED").penaltyAdjustment < 0,
    "spike + low quality ticker receives negative penalty"
  );
  assertGte(
    ranked.find(r => r.ticker === "CLEAN").finalScore,
    ranked.find(r => r.ticker === "SPIKED").finalScore,
    "clean signal ranks above spiked signal with equal mentions"
  );
}

function testQualityBoostFromBodyLength() {
  console.log("\n[Quality: body length boosts score]");
  const shallow = sig("SHALLOW", 5, { bodyLengths: Array(5).fill(20) });
  const deep    = sig("DEEP",    5, { bodyLengths: Array(5).fill(800) });
  const ranked  = prioritizeSignals([shallow, deep]);
  assertGte(
    ranked.find(r => r.ticker === "DEEP").qualityScore,
    ranked.find(r => r.ticker === "SHALLOW").qualityScore,
    "deep body length produces higher qualityScore"
  );
}

function testLowQualityPenalty() {
  console.log("\n[Low-quality penalty]");
  const lowQ = sig("LOWQ", 5, {
    bodyLengths:      Array(5).fill(15),  // all very short
    engagementRatios: Array(5).fill(0.01), // near-zero engagement
  });
  const ranked = prioritizeSignals([lowQ]);
  assert(
    ranked[0].penaltyAdjustment < 0,
    "thin body + no engagement produces negative penaltyAdjustment"
  );
}

function testScoreFloor() {
  console.log("\n[Score floor]");
  // Worst case: everything bad
  const worst = sig("WORST", 1, {
    bodyLengths:      [5],
    engagementRatios: [0],
    mentionTimes:     [nowS],
    uniqueSubreddits: ["wallstreetbets"],
  });
  const ranked = prioritizeSignals([worst]);
  assert(ranked[0].finalScore >= 5, "finalScore never drops below SCORE_FLOOR (5)");
}

function testSummary() {
  console.log("\n[Summary]");
  const ranked  = prioritizeSignals([sig("NVDA",10), sig("AMD",5)]);
  const summary = summarizePrioritization(ranked);
  for (const field of ["count","topTicker","topScore","avgScore","scoreRange","penalized","weights"]) {
    assert(field in summary, `summary has field: ${field}`);
  }
  assertEqual(summary.count, 2, "summary count correct");
  assert("base" in summary.weights, "summary.weights includes base");
  assert("modifiers" in summary.weights, "summary.weights includes modifiers");
}

function testEmptyInput() {
  console.log("\n[Edge cases]");
  assertEqual(prioritizeSignals([]).length,   0, "empty array returns empty");
  assertEqual(prioritizeSignals(null).length, 0, "null returns empty");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function runAll() {
  let passed = 0, failed = 0;
  const suites = [
    testWeights, testOutputShape, testScoreRanges, testDeterminism,
    testSortOrder, testTieBreakerAlphabetical, testConcentrationBoost,
    testConsistencyVsSpike, testSpikePenalty, testQualityBoostFromBodyLength,
    testLowQualityPenalty, testScoreFloor, testSummary, testEmptyInput,
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