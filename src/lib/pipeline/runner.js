// /lib/pipeline/runner.js
// Pipeline orchestrator.
//
// Stage order:
//   1. Ingest    — fetch Reddit posts (hot + themed)
//   2. Normalize — clean and quality-filter posts
//   3. Extract   — identify tickers per post
//   4. Snapshot  — build atomic, time-windowed snapshot
//   5. Aggregate — produce TickerSignal[] for ranking
//
// Every run produces a Snapshot that is:
//   - stored in snapshotStore for velocity calculations
//   - returned in the result for the ranking stage

import { fetchRedditBatch }              from "./ingest.js";
import { normalizePosts }                from "./normalize.js";
import { extractFromPosts, KNOWN_TICKERS } from "./extract.js";
import { buildSnapshot, validateSnapshot } from "./snapshot.js";
import { saveSnapshot }                  from "./snapshotStore.js";
import { aggregateTickers }              from "./aggregate.js";
import { getEdgeStats }                  from "./edgeLog.js";

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run the full discovery pipeline.
 *
 * @param {object}   options
 * @param {number}   options.topN            — max tickers in output (default 20)
 * @param {boolean}  options.validateTickers — validate against known ticker list (default true)
 * @param {boolean}  options.dryRun          — use mock data instead of live Reddit
 * @param {string[]} options.themes          — investment themes for targeted search
 * @param {number}   options.windowHours     — snapshot time window in hours (default 6)
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline({
  topN            = 20,
  validateTickers = true,
  dryRun          = false,
  themes          = ["AI", "oil", "interest rates", "crypto"],
  windowHours     = 6,
} = {}) {
  const startTime = Date.now();
  const stages    = {};

  // ── Stage 1: Ingest ────────────────────────────────────────────────────────

  let posts, ingestMeta, themedBatches = [];

  if (dryRun) {
    ({ posts, themedBatches, meta: ingestMeta } = getMockBatch());
  } else {
    ({ posts, themedBatches, meta: ingestMeta } = await fetchRedditBatch({
      themes,
      skipThemes: themes.length === 0,
    }));
  }

  stages.ingest = {
    postCount:    posts.length,
    hotPosts:     ingestMeta.hotPosts    ?? posts.length,
    themePosts:   ingestMeta.themePosts  ?? 0,
    dedupedOut:   ingestMeta.dedupedOut  ?? 0,
    durationMs:   ingestMeta.durationMs,
    perSubreddit: ingestMeta.perSubreddit,
    themes:       ingestMeta.themeSearch?.themes   ?? themes,
    themeQueries: ingestMeta.themeSearch?.queries  ?? 0,
  };

  if (posts.length === 0) {
    return buildResult({ stages, signals: [], snapshot: null, themedBatches, startTime, error: "No posts fetched" });
  }

  // ── Stage 2: Normalize ─────────────────────────────────────────────────────

  const normalized = normalizePosts(posts);
  stages.normalize = {
    processed: normalized.length,
    filtered:  posts.length - normalized.length,
  };

  // ── Stage 3: Extract ───────────────────────────────────────────────────────

  const knownSet  = validateTickers ? KNOWN_TICKERS : null;
  const extracted = extractFromPosts(normalized, knownSet);

  const totalMentions  = extracted.reduce((s, e) => s + e.tickers.length, 0);
  const uniqueTickers  = new Set(extracted.flatMap(e => e.tickers));

  stages.extract = {
    totalMentions,
    uniqueTickers: uniqueTickers.size,
    validating:    validateTickers,
  };

  // ── Stage 4: Snapshot ──────────────────────────────────────────────────────

  const snapshot = buildSnapshot({
    posts,
    extracted,
    windowHours,
    ingestMeta,
  });

  // Validate before storing — log violations but don't abort the run
  const violations = validateSnapshot(snapshot);
  if (violations.length > 0) {
    console.warn("[runner] Snapshot validation warnings:", violations);
  }

  saveSnapshot(snapshot);

  stages.snapshot = {
    snapshotId:  snapshot.snapshotId,
    windowHours: snapshot.windowHours,
    windowStart: snapshot.windowStart,
    postCount:   snapshot.postCount,
    tickerCount: snapshot.tickerCount,
    violations:  violations.length,
  };

  // ── Stage 5: Aggregate ─────────────────────────────────────────────────────

  const signals = aggregateTickers(extracted, { topN });

  stages.aggregate = {
    candidateTickers: signals.length,
    topTicker:        signals[0]?.ticker ?? null,
    edgeCases:        getEdgeStats(),
  };

  return buildResult({ stages, signals, snapshot, themedBatches, startTime });
}

// ─── Result builder ────────────────────────────────────────────────────────────

function buildResult({ stages, signals, snapshot, themedBatches = [], startTime, error = null }) {
  return {
    signals,
    snapshot,      // full snapshot object — available for ranking stage
    themedBatches,
    meta: {
      timestamp:  Date.now(),
      durationMs: Date.now() - startTime,
      stages,
      error,
    },
  };
}

// ─── Mock batch ───────────────────────────────────────────────────────────────

function getMockBatch() {
  const now = Math.floor(Date.now() / 1000);

  // Mock posts use canonical Post schema fields
  const posts = [
    { id:"mock1", subreddit:"wallstreetbets", source:"hot",   theme:null,
      title:"SMCI is massively undervalued — AI server exposure nobody talking about",
      body:"SMCI liquid cooling partnership with NVDA. Revenue guidance $14-15B.",
      upvotes:1240, numComments:340, createdUtc:now-1800, url:"#", extractedTickers:[] },
    { id:"mock2", subreddit:"stocks",         source:"hot",   theme:null,
      title:"CELH deep dive — why the selloff is overdone",
      body:"CELH down 60% from highs. PEP distribution intact. International expansion.",
      upvotes:445,  numComments:89,  createdUtc:now-3600, url:"#", extractedTickers:[] },
    { id:"mock3", subreddit:"wallstreetbets", source:"theme", theme:"AI",
      title:"NVDA AI infrastructure thesis — capex cycle just starting",
      body:"NVDA AMD SMCI — entire AI buildout stack. Hyperscalers accelerating.",
      upvotes:2890, numComments:720, createdUtc:now-600,  url:"#", extractedTickers:[] },
    { id:"mock4", subreddit:"investing",      source:"theme", theme:"interest rates",
      title:"TLT and IEF for the rate cut trade. ZROZ for maximum duration",
      body:"Most asymmetric macro setup in 3 years. 10yr at 5% unsustainable.",
      upvotes:312,  numComments:156, createdUtc:now-7200, url:"#", extractedTickers:[] },
    { id:"mock5", subreddit:"stocks",         source:"theme", theme:"uranium",
      title:"CCJ uranium thesis — 10 year supply deal just signed",
      body:"CCJ signed major utility agreement. Nuclear renaissance is real. URA for exposure.",
      upvotes:567,  numComments:203, createdUtc:now-2400, url:"#", extractedTickers:[] },
    { id:"mock6", subreddit:"wallstreetbets", source:"hot",   theme:null,
      title:"GME Roaring Kitty is back — all in",
      body:"GME calls. Diamond hands.",
      upvotes:3200, numComments:1400,createdUtc:now-900,  url:"#", extractedTickers:[] },
    { id:"mock7", subreddit:"investing",      source:"theme", theme:"crypto",
      title:"MSTR vs IBIT — the NAV premium argument",
      body:"MSTR trades at 2x NAV to BTC. IBIT and FBTC available. Arb will close.",
      upvotes:289,  numComments:78,  createdUtc:now-5400, url:"#", extractedTickers:[] },
    { id:"mock8", subreddit:"stocks",         source:"theme", theme:"AI",
      title:"AMD vs NVDA in AI data center — who wins long term",
      body:"AMD MI300 gaining ground. NVDA dominant but AMD closing gap.",
      upvotes:678,  numComments:234, createdUtc:now-4800, url:"#", extractedTickers:[] },
    { id:"mock9", subreddit:"wallstreetbets", source:"hot",   theme:null,
      title:"PLTR earnings — government contracts expanding",
      body:"PLTR DoD contracts. AIP is real. Commercial growing 55% YoY.",
      upvotes:891,  numComments:312, createdUtc:now-1200, url:"#", extractedTickers:[] },
    { id:"mock10",subreddit:"investing",      source:"hot",   theme:null,
      title:"Why buying GOOG here — search moat underappreciated",
      body:"GOOG at 18x earnings growing 15%. YouTube and cloud not priced in.",
      upvotes:445,  numComments:167, createdUtc:now-9000, url:"#", extractedTickers:[] },
  ];

  return {
    posts,
    themedBatches: [
      { theme:"AI",             query:"AI stocks earnings",           posts: posts.filter(p => p.theme === "AI") },
      { theme:"interest rates", query:"Fed rate decision stocks",     posts: posts.filter(p => p.theme === "interest rates") },
      { theme:"crypto",         query:"crypto stocks thesis Bitcoin",  posts: posts.filter(p => p.theme === "crypto") },
      { theme:"uranium",        query:"uranium nuclear energy stocks", posts: posts.filter(p => p.theme === "uranium") },
    ],
    meta: {
      timestamp:    Date.now(),
      durationMs:   0,
      totalPosts:   posts.length,
      hotPosts:     5,
      themePosts:   5,
      dedupedOut:   0,
      perSubreddit: { wallstreetbets:4, stocks:4, investing:4 },
      themeSearch:  { queries:4, posts:5, themes:["AI","interest rates","crypto","uranium"] },
    },
  };
}
