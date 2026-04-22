// /lib/pipeline/runner.js
// Pipeline orchestrator.
// Runs: ingest -> normalize -> extract -> aggregate -> output
// One call = one complete pipeline run.
// Designed to execute every 15-60 minutes.

import { fetchRedditBatch } from "./ingest.js";
import { normalizePosts } from "./normalize.js";
import { extractFromPosts, KNOWN_TICKERS } from "./extract.js";
import { aggregateTickers, recordHistory } from "./aggregate.js";

/**
 * Run the full discovery pipeline.
 *
 * @param {object}   options
 * @param {number}   options.topN            - max tickers in output (default 20)
 * @param {boolean}  options.validateTickers - filter against known ticker list (default true)
 * @param {boolean}  options.dryRun          - skip Reddit fetch, use mock data
 * @param {string[]} options.themes          - investment themes for targeted search
 *                                            e.g. ["AI", "oil", "interest rates", "crypto"]
 *                                            Pass [] to run hot-feed only.
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline({
  topN = 20,
  validateTickers = true,
  dryRun = false,
  themes = ["AI", "oil", "interest rates", "crypto"],
} = {}) {
  const startTime = Date.now();
  const stages = {};

  // Stage 1: Ingest
  let posts;
  let ingestMeta;
  let themedBatches = [];

  if (dryRun) {
    ({ posts, themedBatches, meta: ingestMeta } = getMockBatch());
  } else {
    ({ posts, themedBatches, meta: ingestMeta } = await fetchRedditBatch({
      themes,
      skipThemes: themes.length === 0,
    }));
  }

  stages.ingest = {
    postCount: posts.length,
    hotPosts: ingestMeta.hotPosts ?? posts.length,
    themePosts: ingestMeta.themePosts ?? 0,
    dedupedOut: ingestMeta.dedupedOut ?? 0,
    durationMs: ingestMeta.durationMs,
    perSubreddit: ingestMeta.perSubreddit,
    themes: ingestMeta.themeSearch?.themes ?? themes,
    themeQueries: ingestMeta.themeSearch?.queries ?? 0,
  };

  if (posts.length === 0) {
    return buildResult({ stages, signals: [], themedBatches, startTime, error: "No posts fetched" });
  }

  // Stage 2: Normalize
  const normalized = normalizePosts(posts);
  stages.normalize = { processed: normalized.length };

  // Stage 3: Extract
  const knownSet = validateTickers ? KNOWN_TICKERS : null;
  const extracted = extractFromPosts(normalized, knownSet);

  const totalTickerMentions = extracted.reduce((sum, entry) => sum + entry.tickers.length, 0);
  const uniqueTickers = new Set(extracted.flatMap((entry) => entry.tickers));

  stages.extract = {
    totalMentions: totalTickerMentions,
    uniqueTickers: uniqueTickers.size,
    validating: validateTickers,
  };

  // Stage 4+5: Aggregate + Velocity
  const signals = aggregateTickers(extracted, { topN });

  const mentionMap = Object.fromEntries(signals.map((signal) => [signal.ticker, signal.mentions]));
  recordHistory(mentionMap);

  stages.aggregate = {
    candidateTickers: signals.length,
    topTicker: signals[0]?.ticker || null,
  };

  return buildResult({ stages, signals, themedBatches, startTime });
}

// Result builder
function buildResult({ stages, signals, themedBatches = [], startTime, error = null }) {
  return {
    signals,
    themedBatches,
    meta: {
      timestamp: Date.now(),
      durationMs: Date.now() - startTime,
      stages,
      error,
    },
  };
}

// Mock batch for dry runs / testing
function getMockBatch() {
  const now = Math.floor(Date.now() / 1000);
  const posts = [
    {
      id: "mock1", subreddit: "wallstreetbets", source: "hot", theme: null,
      title: "SMCI is massively undervalued right now. AI server exposure nobody is talking about",
      body: "SMCI has liquid cooling partnership with NVDA. Revenue guidance $14-15B. Completely overlooked.",
      score: 1240, created_utc: now - 1800, url: "#", num_comments: 340,
    },
    {
      id: "mock2", subreddit: "stocks", source: "hot", theme: null,
      title: "CELH deep dive - why the selloff is overdone",
      body: "CELH down 60% from highs. PEP distribution intact. International expansion UK France Australia. Management bought $2M shares.",
      score: 445, created_utc: now - 3600, url: "#", num_comments: 89,
    },
    {
      id: "mock3", subreddit: "wallstreetbets", source: "theme", theme: "AI",
      title: "NVDA AI infrastructure thesis - why the capex cycle is just starting",
      body: "NVDA AMD SMCI - the entire AI buildout stack. Hyperscalers still accelerating capex. Inference demand next wave.",
      score: 2890, created_utc: now - 600, url: "#", num_comments: 720,
    },
    {
      id: "mock4", subreddit: "investing", source: "theme", theme: "interest rates",
      title: "Macro thesis: TLT and IEF for the rate cut trade. ZROZ for maximum duration",
      body: "If you believe rates are peaking, duration is the most asymmetric macro setup in 3 years. 10yr at 5% is unsustainable.",
      score: 312, created_utc: now - 7200, url: "#", num_comments: 156,
    },
    {
      id: "mock5", subreddit: "stocks", source: "theme", theme: "uranium",
      title: "CCJ uranium thesis - 10 year supply deal just signed",
      body: "CCJ signed major utility supply agreement. Nuclear renaissance is real. URA for diversified exposure. Cameco has pricing power.",
      score: 567, created_utc: now - 2400, url: "#", num_comments: 203,
    },
    {
      id: "mock6", subreddit: "wallstreetbets", source: "hot", theme: null,
      title: "GME GME GME Roaring Kitty is back. All in",
      body: "YOLO GME calls. Diamond hands. To the moon.",
      score: 3200, created_utc: now - 900, url: "#", num_comments: 1400,
    },
    {
      id: "mock7", subreddit: "investing", source: "theme", theme: "crypto",
      title: "MSTR vs IBIT - the NAV premium argument",
      body: "MSTR trades at 2x NAV to BTC holdings. With IBIT and FBTC available the arb will close. Short thesis compelling.",
      score: 289, created_utc: now - 5400, url: "#", num_comments: 78,
    },
    {
      id: "mock8", subreddit: "stocks", source: "theme", theme: "AI",
      title: "AMD vs NVDA in the AI data center - who wins long term?",
      body: "AMD MI300 is gaining ground. NVDA still dominant but AMD closing gap. Both in my portfolio.",
      score: 678, created_utc: now - 4800, url: "#", num_comments: 234,
    },
    {
      id: "mock9", subreddit: "wallstreetbets", source: "hot", theme: null,
      title: "PLTR earnings play - government contracts expanding",
      body: "PLTR AI platform getting DoD contracts. AIP is real. Q4 guidance raised. Commercial segment growing 55% YoY.",
      score: 891, created_utc: now - 1200, url: "#", num_comments: 312,
    },
    {
      id: "mock10", subreddit: "investing", source: "hot", theme: null,
      title: "Why I'm buying GOOG here - search moat underappreciated",
      body: "GOOG at 18x earnings while growing 15%. YouTube and cloud not priced in. AI overview integration driving engagement.",
      score: 445, created_utc: now - 9000, url: "#", num_comments: 167,
    },
  ];

  return {
    posts,
    themedBatches: [
      { theme: "AI", query: "AI stocks earnings", posts: posts.filter((post) => post.theme === "AI") },
      { theme: "interest rates", query: "Fed rate decision stocks", posts: posts.filter((post) => post.theme === "interest rates") },
      { theme: "crypto", query: "crypto stocks thesis Bitcoin", posts: posts.filter((post) => post.theme === "crypto") },
      { theme: "uranium", query: "uranium nuclear energy stocks", posts: posts.filter((post) => post.theme === "uranium") },
    ],
    meta: {
      timestamp: Date.now(),
      durationMs: 0,
      totalPosts: posts.length,
      hotPosts: 5,
      themePosts: 5,
      dedupedOut: 0,
      perSubreddit: { wallstreetbets: 4, stocks: 4, investing: 4 },
      themeSearch: { queries: 4, posts: 5, themes: ["AI", "interest rates", "crypto", "uranium"] },
    },
  };
}
