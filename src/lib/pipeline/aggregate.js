// /lib/pipeline/aggregate.js
// Stage 4 + 5: Aggregation and attention velocity.
// Builds the per-ticker signal map and classifies velocity.

// ─── In-memory history store ──────────────────────────────────────────────────
// Keyed by ticker → array of { timestamp, mentions }
// Persisted externally by the pipeline runner.

const tickerHistory = {};

/**
 * Record a snapshot of mention counts into history.
 * Called at the end of each pipeline run.
 *
 * @param {{ [ticker: string]: number }} mentionMap
 */
export function recordHistory(mentionMap) {
  const timestamp = Date.now();
  Object.entries(mentionMap).forEach(([ticker, mentions]) => {
    if (!tickerHistory[ticker]) tickerHistory[ticker] = [];
    tickerHistory[ticker].push({ timestamp, mentions });
    // Keep only last 48 snapshots (~24h at 30min cadence)
    if (tickerHistory[ticker].length > 48) tickerHistory[ticker].shift();
  });
}

/**
 * Get the full history store (for persistence).
 */
export function getHistory() {
  return tickerHistory;
}

/**
 * Load history from an external store (e.g. JSON file on startup).
 * @param {{ [ticker: string]: Array<{ timestamp, mentions }> }} saved
 */
export function loadHistory(saved) {
  Object.assign(tickerHistory, saved);
}

// ─── Velocity classification ──────────────────────────────────────────────────

/**
 * Classify velocity for a ticker given current mentions and history.
 *
 * Strategy:
 * 1. If history exists → ratio of now vs. last snapshot
 * 2. If no history → use post recency clustering as proxy
 *
 * @param {string} ticker
 * @param {number} currentMentions
 * @param {Post[]} posts - posts where this ticker was found
 * @returns {"low" | "medium" | "high"}
 */
function classifyVelocity(ticker, currentMentions, posts) {
  const history = tickerHistory[ticker];

  if (history && history.length >= 2) {
    // Compare current to previous snapshot
    const prev = history[history.length - 1].mentions;
    if (prev === 0) return currentMentions > 0 ? "high" : "low";

    const ratio = currentMentions / prev;
    if (ratio >= 1.5) return "high";
    if (ratio >= 0.85) return "medium";
    return "low";
  }

  // No history — proxy via recency clustering
  // High velocity = many posts in the last 2 hours
  const now = Math.floor(Date.now() / 1000);
  const twoHoursAgo = now - 2 * 60 * 60;
  const recentCount = posts.filter((p) => p.created_utc >= twoHoursAgo).length;

  if (recentCount >= 3) return "high";
  if (recentCount >= 1) return "medium";
  return "low";
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Aggregate ticker data across all extracted posts into a ranked signal map.
 *
 * @param {Array<{ post: Post, tickers: string[] }>} extracted
 * @param {object} options
 * @param {number} options.topN - max tickers to return (default 20)
 * @returns {TickerSignal[]}
 */
export function aggregateTickers(extracted, { topN = 20 } = {}) {
  // Build raw aggregation map
  const map = {}; // ticker → { mentions, posts: Set }

  for (const { post, tickers } of extracted) {
    for (const ticker of tickers) {
      if (!map[ticker]) map[ticker] = { mentions: 0, posts: [] };
      map[ticker].mentions++;
      map[ticker].posts.push(post);
    }
  }

  // Convert to array and sort by mentions descending
  const sorted = Object.entries(map)
    .map(([ticker, data]) => ({ ticker, ...data }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, topN);

  // Enrich with velocity, sample posts, avg score
  return sorted.map(({ ticker, mentions, posts }) => {
    const velocity = classifyVelocity(ticker, mentions, posts);

    // Sample posts: prefer highest upvote score, max 3
    const samplePosts = [...posts]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((p) => ({
        title: p.title,
        score: p.score,
        subreddit: p.subreddit,
        url: p.url,
        created_utc: p.created_utc,
        bodyPreview: p.body ? p.body.slice(0, 200).replace(/\n+/g, " ") : "",
      }));

    const avgScore =
      posts.length > 0
        ? Math.round(posts.reduce((s, p) => s + p.score, 0) / posts.length)
        : 0;

    const lastSeen = Math.max(...posts.map((p) => p.created_utc)) * 1000;

    return {
      ticker,
      mentions,
      velocity,
      avgScore,
      lastSeen,
      samplePosts,
      postCount: posts.length,
    };
  });
}
