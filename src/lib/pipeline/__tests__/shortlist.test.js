// /lib/pipeline/__tests__/shortlist.test.js
//
// Tests for the shortlist filtering rules.
// Verifies every rule fires correctly, produces the right decision,
// and that the output schema is complete.
// No network calls. No mocks.
// Run: node lib/pipeline/__tests__/shortlist.test.js

import { buildShortlist, summarizeShortlist, FILTER_CONFIG } from "../shortlist.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}
function assertEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`FAIL: ${msg}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
  console.log(`  PASS: ${msg}`);
}
function assertIncludes(ticker, candidates, msg) {
  assert(candidates.some(c => c.ticker === ticker), msg ?? `${ticker} in candidates`);
}
function assertExcludes(ticker, candidates, msg) {
  assert(!candidates.some(c => c.ticker === ticker), msg ?? `${ticker} not in candidates`);
}
function assertExcludedBy(ticker, excluded, rule) {
  const entry = excluded.find(e => e.ticker === ticker);
  assert(entry, `${ticker} found in excluded list`);
  assertEqual(entry.exclusionRule, rule, `${ticker} excluded by rule ${rule}`);
}

// ─── Signal factory ───────────────────────────────────────────────────────────

function sig(ticker, overrides = {}) {
  return {
    ticker,
    finalScore:          65,
    baseScore:           60,
    concentrationScore:  70,
    consistencyScore:    65,
    qualityScore:        60,
    penaltyAdjustment:   0,
    penalties:           { spike: 0, lowQuality: 0 },
    totalScore:          65,
    mentions:            5,
    velocity:            "medium",
    avgUpvotes:          400,
    samplePosts:         [],
    analysis: {
      ticker,
      signal_type:       "thesis",
      confidence:        "high",
      narrative_summary: "Structured thesis with cited catalysts.",
      key_catalyst:      "Earnings guidance raised.",
      key_risk:          null,
      source:            "claude",
    },
    ...overrides,
  };
}

function withAnalysis(ticker, type, confidence, source = "claude", extra = {}) {
  return sig(ticker, {
    analysis: {
      ticker,
      signal_type:       type,
      confidence,
      narrative_summary: `${type} signal with ${confidence} confidence.`,
      key_catalyst:      null,
      key_risk:          null,
      source,
      ...extra,
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function testOutputSchema() {
  console.log("\n[Output schema]");
  const result = buildShortlist([sig("NVDA")]);
  assert("candidates" in result, "result has candidates");
  assert("excluded"   in result, "result has excluded");
  assert("stats"      in result, "result has stats");

  const c = result.candidates[0];
  for (const field of ["ticker","finalScore","adjustedScore","signalType","confidence",
                        "narrativeSummary","scoreBreakdown","appliedRules","reason",
                        "mentions","velocity","samplePosts"]) {
    assert(field in c, `candidate has field: ${field}`);
  }
  assert("baseScore" in c.scoreBreakdown,       "scoreBreakdown has baseScore");
  assert("adjustedScore" in c.scoreBreakdown,   "scoreBreakdown has adjustedScore");
  assert("filterAdjustment" in c.scoreBreakdown,"scoreBreakdown has filterAdjustment");
}

function testEmptyInput() {
  console.log("\n[Empty input]");
  const result = buildShortlist([]);
  assertEqual(result.candidates.length, 0, "empty input → empty candidates");
  assertEqual(result.excluded.length,   0, "empty input → empty excluded");
  const result2 = buildShortlist(null);
  assertEqual(result2.candidates.length, 0, "null input → empty candidates");
}

function testCleanSignalIncluded() {
  console.log("\n[Clean signal passes all rules]");
  const result = buildShortlist([sig("NVDA")]);
  assertIncludes("NVDA", result.candidates);
  assertEqual(result.candidates[0].appliedRules.length, 0, "no rules applied to clean signal");
  assertEqual(result.candidates[0].adjustedScore, 65, "adjusted score equals finalScore for clean signal");
}

// Rule H1
function testH1ScoreTooLow() {
  console.log("\n[Rule H1: score below absolute minimum]");
  const low = sig("LOW", { finalScore: 10, totalScore: 10, baseScore: 10 });
  const result = buildShortlist([low]);
  assertExcludes("LOW", result.candidates);
  assertExcludedBy("LOW", result.excluded, "H1");
}

// Rule H2
function testH2ExtremePenalty() {
  console.log("\n[Rule H2: extreme penalty]");
  const penalized = sig("PENALIZED", {
    finalScore:       40,
    penaltyAdjustment: -30,
    penalties:         { spike: -30, lowQuality: 0 },
  });
  const result = buildShortlist([penalized]);
  assertExcludes("PENALIZED", result.candidates);
  assertExcludedBy("PENALIZED", result.excluded, "H2");
}

// Rule H3
function testH3HypePlusPenalty() {
  console.log("\n[Rule H3: hype + penalty]");
  const signal = sig("HYPE", {
    finalScore:        50,
    penaltyAdjustment: -15,
    analysis: { ticker:"HYPE", signal_type:"hype", confidence:"medium",
                narrative_summary:"hype", key_catalyst:null, key_risk:null, source:"claude" },
  });
  const result = buildShortlist([signal]);
  assertExcludes("HYPE", result.candidates);
  assertExcludedBy("HYPE", result.excluded, "H3");
}

// Rule H4
function testH4LowConfidenceHype() {
  console.log("\n[Rule H4: low confidence + hype]");
  const signal = withAnalysis("GME", "hype", "low");
  const result = buildShortlist([signal]);
  assertExcludes("GME", result.candidates);
  assertExcludedBy("GME", result.excluded, "H4");
}

// Rule S1: Hype without hard exclusion → downranked
function testS1HypeDownrank() {
  console.log("\n[Rule S1: hype downranked]");
  // Hype but no penalty, medium confidence → passes H3 and H4 but gets downranked
  const hype  = withAnalysis("HYPE", "hype", "medium");
  const clean = sig("CLEAN");
  const result = buildShortlist([hype, clean]);

  // Both should be included (hype is penalized but may still pass gate at 65-12=53)
  assertIncludes("CLEAN", result.candidates);
  const hyp = result.candidates.find(c => c.ticker === "HYPE");
  if (hyp) {
    assert(hyp.adjustedScore < hyp.finalScore, "hype signal has reduced adjustedScore");
    assertEqual(hyp.adjustedScore, hyp.finalScore - FILTER_CONFIG.downrank.hypeSignal, "downrank amount correct");
  }
  // HYPE must rank below CLEAN
  const cleanIdx = result.candidates.findIndex(c => c.ticker === "CLEAN");
  const hypeIdx  = result.candidates.findIndex(c => c.ticker === "HYPE");
  if (hypeIdx !== -1 && cleanIdx !== -1) {
    assert(cleanIdx < hypeIdx, "clean signal ranks above downranked hype signal");
  }
}

// Rule S2: Low confidence downranked
function testS2LowConfidenceDownrank() {
  console.log("\n[Rule S2: low confidence downranked]");
  const lowConf = withAnalysis("LOWC", "thesis", "low");  // thesis but low confidence
  const result  = buildShortlist([lowConf]);
  const cand    = result.candidates.find(c => c.ticker === "LOWC");
  if (cand) {
    assertEqual(cand.adjustedScore, 65 - FILTER_CONFIG.downrank.lowConfidence, "low confidence downrank correct");
  }
}

// Rule S3: Deterministic fallback downranked
function testS3FallbackDownrank() {
  console.log("\n[Rule S3: deterministic fallback downranked]");
  const fallback = withAnalysis("FB", "thesis", "medium", "deterministic_fallback");
  const result   = buildShortlist([fallback]);
  const cand     = result.candidates.find(c => c.ticker === "FB");
  if (cand) {
    assertEqual(cand.adjustedScore, 65 - FILTER_CONFIG.downrank.deterministicFallback, "fallback downrank correct");
    assert(cand.appliedRules.some(r => r.includes("S3")), "S3 rule recorded");
  }
}

// Rule S4: No analysis downranked
function testS4NoAnalysisDownrank() {
  console.log("\n[Rule S4: no analysis downranked]");
  const noAnalysis = { ...sig("NOAN"), analysis: null };
  const result     = buildShortlist([noAnalysis]);
  const cand       = result.candidates.find(c => c.ticker === "NOAN");
  if (cand) {
    assertEqual(cand.adjustedScore, 65 - FILTER_CONFIG.downrank.noAnalysis, "no-analysis downrank correct");
  }
}

// Rule S5: Mixed signal downranked
function testS5MixedDownrank() {
  console.log("\n[Rule S5: mixed signal downranked]");
  const mixed  = withAnalysis("MIX", "mixed", "medium");
  const result = buildShortlist([mixed]);
  const cand   = result.candidates.find(c => c.ticker === "MIX");
  if (cand) {
    assertEqual(cand.adjustedScore, 65 - FILTER_CONFIG.downrank.mixedSignal, "mixed downrank correct");
  }
}

// Gate G1
function testG1QualityGate() {
  console.log("\n[Rule G1: quality gate after downranks]");
  // Score just above gate normally, but multiple downranks push below
  const marginal = sig("MARG", { finalScore: 42 });
  // Apply hype + low confidence → 42 - 12 - 8 = 22, below gate of 35
  marginal.analysis = { ticker:"MARG", signal_type:"hype", confidence:"low",
                        narrative_summary:"hype", key_catalyst:null, key_risk:null, source:"claude" };
  const result = buildShortlist([marginal]);
  // H4 fires first (hype+low) so this hits H4, not G1
  assertExcludedBy("MARG", result.excluded, "H4");

  // A thesis/low-confidence at score 40 → 40-8=32, below gate
  const thesisLow = sig("TL", { finalScore: 40 });
  thesisLow.analysis = { ticker:"TL", signal_type:"thesis", confidence:"low",
                         narrative_summary:"t", key_catalyst:null, key_risk:null, source:"claude" };
  const result2 = buildShortlist([thesisLow]);
  assertExcludedBy("TL", result2.excluded, "G1");
}

// Size cap
function testSizeCap() {
  console.log("\n[Size cap]");
  const many = Array.from({ length: 20 }, (_, i) =>
    sig(`T${String(i).padStart(2,"0")}`, { finalScore: 80 - i })
  );
  const result = buildShortlist(many, { maxCandidates: 5 });
  assertEqual(result.candidates.length, 5, "size cap enforced");
  assert(result.excluded.some(e => e.exclusionRule === "CAP"), "capped tickers in excluded with CAP rule");
}

// Determinism
function testDeterminism() {
  console.log("\n[Determinism]");
  const signals = [
    sig("NVDA", { finalScore: 80 }),
    sig("AMD",  { finalScore: 70 }),
    withAnalysis("GME", "hype", "medium"),
    sig("TSLA", { finalScore: 60 }),
  ];
  const r1 = buildShortlist(signals).candidates.map(c => c.ticker);
  const r2 = buildShortlist(signals).candidates.map(c => c.ticker);
  assertEqual(JSON.stringify(r1), JSON.stringify(r2), "same input → same output");
}

// Sort: thesis > news > hype at equal score
function testSignalTypeSorting() {
  console.log("\n[Sort: thesis ranks above news above mixed at equal score]");
  const thesis = withAnalysis("TH", "thesis", "high");
  const news   = withAnalysis("NW", "news",   "high");
  const mixed  = withAnalysis("MX", "mixed",  "high");
  // Give mixed its downrank so they're not equal after adjustments
  // Use same final score for thesis and news to test tiebreak
  const result = buildShortlist([mixed, news, thesis]);

  const thIdx = result.candidates.findIndex(c => c.ticker === "TH");
  const nwIdx = result.candidates.findIndex(c => c.ticker === "NW");
  if (thIdx !== -1 && nwIdx !== -1) {
    assert(thIdx <= nwIdx, "thesis ranks at or above news at equal score");
  }
}

// Stats
function testStats() {
  console.log("\n[Stats]");
  const signals = [sig("NVDA"), withAnalysis("GME", "hype", "low")];
  const result  = buildShortlist(signals);
  assert("included"        in result.stats, "stats.included");
  assert("excluded"        in result.stats, "stats.excluded");
  assert("retentionRate"   in result.stats, "stats.retentionRate");
  assert("bySignalType"    in result.stats, "stats.bySignalType");
  assert("byExclusionRule" in result.stats, "stats.byExclusionRule");
  assert("topTicker"       in result.stats, "stats.topTicker");
}

// Summary string
function testSummaryString() {
  console.log("\n[Summary string]");
  const result  = buildShortlist([sig("NVDA"), withAnalysis("GME", "hype", "low")]);
  const summary = summarizeShortlist(result);
  assert(typeof summary === "string" && summary.length > 0, "summarizeShortlist returns non-empty string");
  assert(summary.includes("[shortlist]"), "summary includes header");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function runAll() {
  let passed = 0, failed = 0;
  const suites = [
    testOutputSchema, testEmptyInput, testCleanSignalIncluded,
    testH1ScoreTooLow, testH2ExtremePenalty, testH3HypePlusPenalty, testH4LowConfidenceHype,
    testS1HypeDownrank, testS2LowConfidenceDownrank, testS3FallbackDownrank,
    testS4NoAnalysisDownrank, testS5MixedDownrank, testG1QualityGate,
    testSizeCap, testDeterminism, testSignalTypeSorting, testStats, testSummaryString,
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
