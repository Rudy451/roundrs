// End-to-end stability checks for runDiscoveryPipeline().
// Run: node src/lib/pipeline/__tests__/pipelineStability.test.js

import { runDiscoveryPipeline } from "../runner.js";

const FIXED_NOW = Date.UTC(2026, 4, 11, 18, 0, 0);

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  PASS: ${message}`);
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`FAIL: ${message}\n  expected: ${e}\n  got:      ${a}`);
  }
  console.log(`  PASS: ${message}`);
}

function projection(result) {
  return {
    success: result.success,
    error: result.error,
    summary: {
      postsIngested: result.summary.postsIngested,
      postsFiltered: result.summary.postsFiltered,
      uniqueTickers: result.summary.uniqueTickers,
      candidates: result.summary.candidates,
      topTicker: result.summary.topTicker,
      topScore: result.summary.topScore,
      snapshotId: result.summary.snapshotId,
    },
    signals: result.signals.map(s => ({
      ticker: s.ticker,
      finalScore: s.finalScore,
      velocity: s.velocity,
      signalType: s.analysis?.signal_type ?? null,
      confidence: s.analysis?.confidence ?? null,
      analysisSource: s.analysis?.source ?? null,
    })),
    candidates: result.candidates.map(c => ({
      ticker: c.ticker,
      adjustedScore: c.adjustedScore,
      signalType: c.signalType,
      confidence: c.confidence,
    })),
    snapshot: {
      snapshotId: result.snapshot?.snapshotId,
      enriched: result.snapshot?.enriched,
      postCount: result.snapshot?.postCount,
      tickerCount: result.snapshot?.tickerCount,
      tickers: result.snapshot?.tickers.map(t => ({
        ticker: t.ticker,
        mentions: t.mentions,
        postIds: t.postIds,
      })),
      ranked: result.snapshot?.tickersRanked?.map(t => ({
        ticker: t.ticker,
        finalScore: t.finalScore,
      })),
      shortlisted: result.snapshot?.tickersShortlisted?.map(t => ({
        ticker: t.ticker,
        adjustedScore: t.adjustedScore,
      })),
      aiAnalysis: result.snapshot?.aiAnalysis?.map(a => ({
        ticker: a.ticker,
        signal_type: a.signal_type,
        confidence: a.confidence,
        source: a.source,
      })),
      themes: result.snapshot?.themes,
    },
  };
}

function assertNoDuplicateTickers(items, label) {
  const tickers = items.map(item => item.ticker);
  assertEqual(tickers, [...new Set(tickers)], `${label} has no duplicate tickers`);
}

function assertUppercaseTickers(items, label) {
  assert(items.every(item => item.ticker === item.ticker.toUpperCase()), `${label} tickers are uppercase`);
}

function assertCompleteSnapshot(result, label) {
  const snapshot = result.snapshot;
  assert(snapshot, `${label} has a snapshot`);
  assert(snapshot.enriched === true, `${label} snapshot is enriched`);
  assert(Array.isArray(snapshot.rawPosts), `${label} snapshot has rawPosts`);
  assert(Array.isArray(snapshot.tickers), `${label} snapshot has tickers`);
  assert(Array.isArray(snapshot.tickersRanked), `${label} snapshot has ranked tickers`);
  assert(Array.isArray(snapshot.tickersShortlisted), `${label} snapshot has shortlisted tickers`);
  assert(Array.isArray(snapshot.aiAnalysis), `${label} snapshot has AI analysis array`);
  assert(snapshot.postCount === snapshot.rawPosts.length, `${label} snapshot postCount matches rawPosts`);
  assert(snapshot.tickerCount === snapshot.tickers.length, `${label} snapshot tickerCount matches tickers`);
  assertNoDuplicateTickers(snapshot.tickers, `${label} snapshot`);
  assertUppercaseTickers(snapshot.tickers, `${label} snapshot`);
}

async function runCase(name, options) {
  const result = await runDiscoveryPipeline({
    dryRun: true,
    analyze: true,
    analyzeTimeoutMs: 100,
    analyzeTopN: 10,
    topN: 20,
    maxCandidates: 10,
    nowMs: FIXED_NOW,
    ...options,
  });

  assert(result.success, `${name} completed`);
  assertCompleteSnapshot(result, name);
  assertNoDuplicateTickers(result.signals, `${name} signals`);
  assertNoDuplicateTickers(result.candidates, `${name} candidates`);
  assertUppercaseTickers(result.signals, `${name} signals`);
  assertUppercaseTickers(result.candidates, `${name} candidates`);

  return result;
}

async function runAll() {
  console.log("\n[Repeated same theme/window]");
  const aiA = await runCase("AI 6h run A", { themes: ["AI"], windowHours: 6 });
  const aiB = await runCase("AI 6h run B", { themes: ["AI"], windowHours: 6 });
  assertEqual(projection(aiB), projection(aiA), "same inputs produce identical projected output");

  console.log("\n[Different theme]");
  await runCase("Crypto 6h", { themes: ["crypto"], windowHours: 6 });

  console.log("\n[Different time window]");
  await runCase("AI 3h", { themes: ["AI"], windowHours: 3 });

  console.log("\n[Snapshot without shortlist]");
  const noShortlist = await runCase("AI 6h no shortlist", {
    themes: ["AI"],
    windowHours: 6,
    shortlist: false,
  });
  assertEqual(noShortlist.snapshot.tickersShortlisted, [], "shortlist-disabled snapshot stores empty shortlist array");

  console.log("\nResults: pipeline stability checks passed");
}

runAll().catch(error => {
  console.error(error.message);
  process.exit(1);
});
