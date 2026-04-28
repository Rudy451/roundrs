// /lib/pipeline/__tests__/prioritize.test.js
//
// Tests for the deterministic signal prioritization model.
// No network calls. No mocks. Pure function verification.
// Run with: node lib/pipeline/__tests__/prioritize.test.js

import { prioritizeSignals, WEIGHTS, summarizePrioritization } from "../prioritize.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  PASS: ${message}`);
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(`FAIL: ${message}\n  expected: ${b}\n  got:      ${a}`);
  console.log(`  PASS: ${message}`);
}

function assertRange(val, min, max, message) {
  if (val < min || val > max) {
    throw new Error(`FAIL: ${message}\n  expected ${min}–${max}, got ${val}`);
  }
  console.log(`  PASS: ${message} (${val})`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const nowS = Math.floor(Date.now() / 1000);

function makeSignal(ticker, mentions, overrides = {}) {
  return {
    ticker,
    mentions,
    velocity:    "medium",
    avgUpvotes:  500,
    lastSeen:    nowS * 1000,
    mentionTimes: Array.from({ length: mentions }, (_, i) => nowS - i * 1800),
    subreddits:  ["stocks"],
    samplePosts: [],
    postCount:   mentions,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function testWeightsSum() {
  console.log("\n[Weights]");
  const sum = Object.values(WEIGHTS).reduce((s, v) => s + v, 0);
  assert(Math.abs(sum - 1.0) < 0.001, "weights sum to 1.0");
  assert(WEIGHTS.mentions > 0, "mentions weight is positive");
  assert(WEIGHTS.velocity > 0, "velocity weight is positive");
  assert(WEIGHTS.theme    > 0, "theme weight is positive");
}

function testOutputShape() {
  console.log("\n[Output shape]");
  const signals = [makeSignal("NVDA", 10), makeSignal("AMD", 5)];
  const ranked  = prioritizeSignals(signals);

  assert(Array.isArray(ranked),           "output is an array");
  assertEqual(ranked.length, 2,           "output length matches input");

  const first = ranked[0];
  assert("ticker"        in first,        "has ticker");
  assert("mentionsScore" in first,        "has mentionsScore");
  assert("velocityScore" in first,        "has velocityScore");
  assert("themeScore"    in first,        "has themeScore");
  assert("totalScore"    in first,        "has totalScore");
  assert("mentions"      in first,        "has mentions pass-through");
  assert("samplePosts"   in first,        "has samplePosts pass-through");
}

function testScoreRanges() {
  console.log("\n[Score ranges]");
  const signals = [
    makeSignal("NVDA", 15, { subreddits: ["stocks","wallstreetbets","investing"],
      samplePosts: [{ theme: "AI", subreddit: "stocks" }] }),
    makeSignal("GME",  8),
    makeSignal("CELH", 3),
  ];
  const themeScores = { AI: 88, oil: 70 };
  const ranked = prioritizeSignals(signals, themeScores);

  for (const r of ranked) {
    assertRange(r.mentionsScore, 0, 100, `${r.ticker} mentionsScore in range`);
    assertRange(r.velocityScore, 0, 100, `${r.ticker} velocityScore in range`);
    assertRange(r.themeScore,    0, 100, `${r.ticker} themeScore in range`);
    assertRange(r.totalScore,    0, 100, `${r.ticker} totalScore in range`);
  }
}

function testDeterminism() {
  console.log("\n[Determinism]");
  const signals = [
    makeSignal("NVDA", 10),
    makeSignal("AMD",  7),
    makeSignal("TSLA", 4),
  ];

  const run1 = prioritizeSignals(signals);
  const run2 = prioritizeSignals(signals);

  assertEqual(
    JSON.stringify(run1.map(r => r.ticker)),
    JSON.stringify(run2.map(r => r.ticker)),
    "same input produces same ticker order"
  );
  assertEqual(
    JSON.stringify(run1.map(r => r.totalScore)),
    JSON.stringify(run2.map(r => r.totalScore)),
    "same input produces same scores"
  );
}

function testSortOrder() {
  console.log("\n[Sort order]");
  const signals = [
    makeSignal("NVDA", 15),
    makeSignal("AMD",  3),
    makeSignal("TSLA", 9),
  ];
  const ranked = prioritizeSignals(signals);

  // Scores should be non-increasing
  for (let i = 1; i < ranked.length; i++) {
    assert(
      ranked[i].totalScore <= ranked[i - 1].totalScore,
      `rank ${i + 1} score (${ranked[i].totalScore}) ≤ rank ${i} score (${ranked[i - 1].totalScore})`
    );
  }
}

function testTieBreaking() {
  console.log("\n[Tie breaking]");
  // Equal mentions, no history — should sort alphabetically by ticker
  const signals = [
    makeSignal("TSLA", 5),
    makeSignal("AAPL", 5),
    makeSignal("NVDA", 5),
  ];
  const ranked = prioritizeSignals(signals);

  // All have same mentions so mentionsScore is equal.
  // velocityScore and themeScore will also be equal (same inputs).
  // Tie should break alphabetically.
  const tickers = ranked.map(r => r.ticker);
  const sorted  = [...tickers].sort();
  assertEqual(JSON.stringify(tickers), JSON.stringify(sorted), "ties broken alphabetically");
}

function testMentionsNormalization() {
  console.log("\n[Mentions normalization]");
  const signals = [
    makeSignal("NVDA", 20), // max — should get mentionsScore = 100
    makeSignal("AMD",  10), // half — should get mentionsScore = 50
    makeSignal("TSLA", 0),  // none — should get mentionsScore = 0
  ];
  const ranked = prioritizeSignals(signals);
  const nvda   = ranked.find(r => r.ticker === "NVDA");
  const amd    = ranked.find(r => r.ticker === "AMD");
  const tsla   = ranked.find(r => r.ticker === "TSLA");

  assertEqual(nvda.mentionsScore, 100, "max mentions → mentionsScore 100");
  assertEqual(amd.mentionsScore,  50,  "half of max → mentionsScore 50");
  assertEqual(tsla.mentionsScore, 0,   "zero mentions → mentionsScore 0");
}

function testThemeBoost() {
  console.log("\n[Theme boost]");
  // Two tickers with same mentions — one has theme, one doesn't
  const withTheme = makeSignal("NVDA", 5, {
    subreddits: ["stocks", "wallstreetbets"],
    samplePosts: [{ theme: "AI", subreddit: "stocks" }],
  });
  const noTheme = makeSignal("TSLA", 5, {
    subreddits: ["stocks"],
    samplePosts: [],
  });
  const ranked = prioritizeSignals([withTheme, noTheme], { AI: 90 });

  assert(
    ranked[0].ticker === "NVDA",
    "ticker with high-scoring theme ranks above equal-mention ticker without theme"
  );
  assert(
    ranked[0].themeScore > ranked[1].themeScore,
    "themed ticker has higher themeScore"
  );
}

function testEmptyInput() {
  console.log("\n[Edge cases]");
  assertEqual(prioritizeSignals([]).length, 0, "empty input returns empty array");
  assertEqual(prioritizeSignals(null).length, 0, "null input returns empty array");
}

function testSummary() {
  console.log("\n[Summary]");
  const signals = [makeSignal("NVDA", 10), makeSignal("AMD", 5)];
  const ranked  = prioritizeSignals(signals);
  const summary = summarizePrioritization(ranked);

  assert("count"     in summary, "summary has count");
  assert("topTicker" in summary, "summary has topTicker");
  assert("topScore"  in summary, "summary has topScore");
  assert("avgScore"  in summary, "summary has avgScore");
  assert("weights"   in summary, "summary has weights");
  assertEqual(summary.count, 2, "summary count matches");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function runAll() {
  let passed = 0, failed = 0;
  const suites = [
    testWeightsSum, testOutputShape, testScoreRanges, testDeterminism,
    testSortOrder, testTieBreaking, testMentionsNormalization,
    testThemeBoost, testEmptyInput, testSummary,
  ];
  for (const suite of suites) {
    try { suite(); passed++; }
    catch (e) { console.error(`\n${e.message}`); failed++; }
  }
  console.log(`\n─────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAll();
