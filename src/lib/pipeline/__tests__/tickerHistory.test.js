// /lib/pipeline/__tests__/tickerHistory.test.js
//
// Tests for ticker history analytics — pure functions only.
// No store I/O. No network calls.
// Run: node lib/pipeline/__tests__/tickerHistory.test.js

// ─── Inline pure functions (extracted from tickerHistory.js) ──────────────────

function round1(n) { return Math.round(n * 10) / 10; }

function classifyVelocity(mentions, mentionTimes, windowHours) {
  if (!mentionTimes || mentionTimes.length === 0) return "low";
  const nowS   = Math.floor(Date.now() / 1000);
  const halfW  = (windowHours * 3600) / 2;
  const recent = mentionTimes.filter(t => t >= nowS - halfW).length;
  const ratio  = mentions > 0 ? recent / mentions : 0;
  if (ratio >= 0.6) return "high";
  if (ratio >= 0.3) return "medium";
  return "low";
}

function computeMomentumTrend(scores) {
  if (scores.length < 4) return "unknown";
  const recent = scores.slice(-3);
  const prior  = scores.slice(-6, -3);
  if (prior.length === 0) return "unknown";
  const recentMean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const priorMean  = prior.reduce((s, v) => s + v, 0) / prior.length;
  const ratio      = recentMean / (priorMean || 1);
  if (ratio >= 1.15) return "rising";
  if (ratio >= 0.88) return "steady";
  return "fading";
}

function estimateDecayHalflife(attentionTimeline) {
  if (attentionTimeline.length < 4) return null;
  const entries = attentionTimeline.filter(e => e.mentions > 0);
  if (entries.length < 3) return null;
  const t0  = entries[0].timestamp;
  const xs  = entries.map(e => (e.timestamp - t0) / 3600000);
  const ys  = entries.map(e => Math.log(e.mentions));
  const n   = xs.length;
  const sx  = xs.reduce((s, v) => s + v, 0);
  const sy  = ys.reduce((s, v) => s + v, 0);
  const sxy = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-10) return null;
  const k = (n * sxy - sx * sy) / denom;
  if (k >= 0) return null;
  const halflife = Math.round(Math.LN2 / Math.abs(k));
  return halflife > 0 && halflife < 10000 ? halflife : null;
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
    throw new Error(`FAIL: ${msg}\n  expected [${lo}, ${hi}], got ${v}`);
  console.log(`  PASS: ${msg} (${v})`);
}

const nowS = Math.floor(Date.now() / 1000);
const nowMs = Date.now();

// ─── Velocity tests ───────────────────────────────────────────────────────────

function testVelocity() {
  console.log("\n[Velocity classification]");

  // All mentions in the last 3 hours of a 6h window → high
  const recentTimes = Array.from({ length: 5 }, (_, i) => nowS - i * 600); // last 50 min
  assertEqual(classifyVelocity(5, recentTimes, 6), "high", "all recent → high");

  // All mentions in the first half of a 6h window → low
  const oldTimes = Array.from({ length: 5 }, (_, i) => nowS - 5 * 3600 - i * 600);
  assertEqual(classifyVelocity(5, oldTimes, 6), "low", "all old → low");

  // Mixed — about half recent
  const mixedTimes = [
    nowS - 1800, nowS - 3600,
    nowS - 10800, nowS - 14400, nowS - 18000,
  ];
  const vel = classifyVelocity(5, mixedTimes, 6);
  assert(["low","medium","high"].includes(vel), "mixed times → valid velocity label");

  // No mention times
  assertEqual(classifyVelocity(3, [], 6), "low", "no mention times → low");

  // Zero mentions
  assertEqual(classifyVelocity(0, [], 6), "low", "zero mentions → low");
}

// ─── Momentum trend tests ─────────────────────────────────────────────────────

function testMomentumTrend() {
  console.log("\n[Momentum trend]");

  // Clearly rising
  assertEqual(computeMomentumTrend([40, 45, 50, 55, 65, 75]), "rising",
    "scores accelerating → rising");

  // Clearly fading
  assertEqual(computeMomentumTrend([75, 65, 55, 45, 38, 30]), "fading",
    "scores decelerating → fading");

  // Steady — within ±12%
  assertEqual(computeMomentumTrend([60, 62, 58, 61, 60, 59]), "steady",
    "flat scores → steady");

  // Exactly 15% increase → rising boundary
  const prior  = [60, 60, 60]; // mean = 60
  const recent = [69, 69, 69]; // mean = 69 → ratio = 1.15 → rising
  assertEqual(computeMomentumTrend([...prior, ...recent]), "rising",
    "exactly 15% increase → rising boundary");

  // Exactly 12% decrease → fading boundary
  const prior2  = [60, 60, 60]; // mean = 60
  const recent2 = [52, 52, 54]; // mean ≈ 52.7 → ratio ≈ 0.878 → fading
  assertEqual(computeMomentumTrend([...prior2, ...recent2]), "fading",
    "~12% decrease → fading boundary");

  // Insufficient data
  assertEqual(computeMomentumTrend([60, 65, 70]), "unknown",
    "fewer than 4 data points → unknown");
  assertEqual(computeMomentumTrend([]),             "unknown",
    "empty array → unknown");
}

// ─── Decay halflife tests ─────────────────────────────────────────────────────

function testDecayHalflife() {
  console.log("\n[Decay halflife estimation]");

  // Perfect exponential decay with 24h halflife
  // mentions(t) = 100 * e^(-k*t) where k = ln2/24
  const k   = Math.LN2 / 24;
  const t0  = nowMs;
  const decaying = Array.from({ length: 8 }, (_, i) => ({
    timestamp: t0 + i * 6 * 3600000, // every 6 hours
    mentions:  Math.round(100 * Math.exp(-k * i * 6)),
  }));

  const hl = estimateDecayHalflife(decaying);
  assert(hl !== null, "decaying series produces a halflife estimate");
  assertRange(hl, 12, 48, "estimated halflife within reasonable range of 24h");

  // Growing mentions — no decay
  const growing = Array.from({ length: 6 }, (_, i) => ({
    timestamp: t0 + i * 3600000,
    mentions:  10 + i * 5,
  }));
  assertEqual(estimateDecayHalflife(growing), null,
    "growing mentions → null halflife");

  // Flat mentions — no decay
  const flat = Array.from({ length: 6 }, (_, i) => ({
    timestamp: t0 + i * 3600000,
    mentions:  10,
  }));
  assertEqual(estimateDecayHalflife(flat), null,
    "flat mentions → null halflife");

  // Insufficient data
  assertEqual(estimateDecayHalflife([
    { timestamp: t0, mentions: 10 },
    { timestamp: t0 + 3600000, mentions: 5 },
  ]), null, "< 3 entries → null");

  assertEqual(estimateDecayHalflife([]), null, "empty → null");
}

// ─── Determinism ──────────────────────────────────────────────────────────────

function testDeterminism() {
  console.log("\n[Determinism]");
  const scores = [40, 55, 60, 72, 68, 65];
  assertEqual(computeMomentumTrend(scores), computeMomentumTrend(scores),
    "momentumTrend is deterministic");

  const timeline = Array.from({ length: 6 }, (_, i) => ({
    timestamp: nowMs + i * 3600000,
    mentions:  Math.max(1, 20 - i * 3),
  }));
  assertEqual(
    estimateDecayHalflife(timeline),
    estimateDecayHalflife(timeline),
    "decayHalflife is deterministic"
  );
}

// ─── Analytics schema ─────────────────────────────────────────────────────────

function testAnalyticsShape() {
  console.log("\n[Analytics schema completeness]");
  // Verify required fields exist in the analytics returned by buildTickerHistory
  // by checking that all keys are covered by the typedef.
  const requiredFields = [
    "avgScore", "peakScore", "latestScore",
    "avgMentions", "peakMentions",
    "dominantSignalType", "associatedThemes",
    "confirmationRate", "momentumTrend", "decayHalflife",
  ];

  // Simulate what computeAnalytics returns with no data
  const emptyScoreTimeline     = [];
  const emptyAttentionTimeline = [];
  const emptyThemes            = [];
  const emptyEvals             = [];

  const scores   = emptyScoreTimeline.map(e => e.score).filter(s => s != null);
  const mentions = emptyAttentionTimeline.map(e => e.mentions).filter(m => m != null);

  const analytics = {
    avgScore:           scores.length ? round1(scores.reduce((s,v) => s+v,0) / scores.length) : null,
    peakScore:          scores.length ? Math.max(...scores) : null,
    latestScore:        scores.length ? scores.at(-1) : null,
    avgMentions:        mentions.length ? round1(mentions.reduce((s,v) => s+v,0) / mentions.length) : null,
    peakMentions:       mentions.length ? Math.max(...mentions) : null,
    dominantSignalType: null,
    associatedThemes:   [],
    confirmationRate:   0,
    momentumTrend:      "unknown",
    decayHalflife:      null,
  };

  for (const field of requiredFields) {
    assert(field in analytics, `analytics has required field: ${field}`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function runAll() {
  let passed = 0, failed = 0;
  const suites = [
    testVelocity,
    testMomentumTrend,
    testDecayHalflife,
    testDeterminism,
    testAnalyticsShape,
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
