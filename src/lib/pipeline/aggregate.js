// /lib/pipeline/aggregate.js
// Stage 4: Aggregation and velocity classification.
//
// Produces the TickerSignal[] array that feeds the ranking stage.
// Reads from the snapshot store for velocity calculations — no local state.
//
// Field names align with the canonical Post schema (post.js):
//   post.upvotes     (not post.score)
//   post.createdUtc  (not post.created_utc)
//   post.numComments (not post.num_comments)

// ─── Velocity classification ──────────────────────────────────────────────────

/**
 * Classify velocity for a ticker using the previous snapshot for comparison.
 * Falls back to recency clustering if no history is available.
 *
 * @param {string}   ticker
 * @param {number}   currentMentions
 * @param {Post[]}   posts           — posts in which this ticker appears
 * @returns {"low" | "medium" | "high"}
 */
function classifyVelocity(ticker, currentMentions, posts, { nowMs = Date.now(), historySnapshots } = {}) {
  // Primary strategy: compare to previous snapshot
  const prev = historySnapshots?.[0] ?? null;

  if (prev) {
    const prevRecord = prev.tickers.find(t => t.ticker === ticker);
    const prevMentions = prevRecord?.mentions ?? 0;

    if (prevMentions === 0) {
      // New ticker — first appearance
      return currentMentions >= 3 ? "high" : "medium";
    }

    const ratio = currentMentions / prevMentions;
    if (ratio >= 1.5)  return "high";
    if (ratio >= 0.85) return "medium";
    return "low";
  }

  // Fallback: recency clustering (no snapshot history yet)
  const nowS         = Math.floor(nowMs / 1000);
  const twoHoursAgoS = nowS - 2 * 60 * 60;
  const recentCount  = posts.filter(p => p.createdUtc >= twoHoursAgoS).length;

  if (recentCount >= 3) return "high";
  if (recentCount >= 1) return "medium";
  return "low";
}

// ─── Main aggregation ─────────────────────────────────────────────────────────

/**
 * Aggregate extracted tickers into ranked TickerSignal objects.
 *
 * Counting rule: one mention per post per ticker.
 * If a post mentions NVDA three times, that counts as one mention of NVDA.
 * This matches the snapshot builder's counting rule exactly.
 *
 * @param {Array<{ post: Post, tickers: string[] }>} extracted
 * @param {object} options
 * @param {number} options.topN — max signals to return (default 20)
 * @returns {TickerSignal[]}
 */
export function aggregateTickers(extracted, { topN = 20, nowMs = Date.now(), historySnapshots } = {}) {
  // Build map: ticker → { postSet, posts[] }
  // postSet prevents double-counting if the same post appears twice in extracted
  const map = new Map();

  for (const { post, tickers } of extracted) {
    // Deduplicate tickers within this post before counting
    const unique = [...new Set(tickers.map(t => t.toUpperCase().trim()))];

    for (const ticker of unique) {
      if (!map.has(ticker)) {
        map.set(ticker, { postIds: new Set(), posts: [] });
      }
      const entry = map.get(ticker);
      if (!entry.postIds.has(post.id)) {
        entry.postIds.add(post.id);
        entry.posts.push(post);
      }
    }
  }

  // Convert to array, sort by mentions DESC then ticker ASC (deterministic)
  const sorted = [...map.entries()]
    .map(([ticker, { posts }]) => ({ ticker, posts }))
    .sort((a, b) => {
      const diff = b.posts.length - a.posts.length;
      return diff !== 0 ? diff : a.ticker.localeCompare(b.ticker);
    })
    .slice(0, topN);

  // Enrich with velocity and sample posts
  return sorted.map(({ ticker, posts }) => {
    const mentions  = posts.length;
    const velocity  = classifyVelocity(ticker, mentions, posts, { nowMs, historySnapshots });

    // Sample posts: highest upvotes first, max 3
    // Uses canonical post.upvotes field
    const samplePosts = [...posts]
      .sort((a, b) => {
        if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 3)
      .map(p => ({
        id:          p.id,
        title:       p.title,
        upvotes:     p.upvotes,
        numComments: p.numComments,
        subreddit:   p.subreddit,
        url:         p.url,
        createdUtc:  p.createdUtc,
        bodyPreview: p.body ? p.body.slice(0, 200).replace(/\n+/g, " ") : "",
        source:      p.source,
        theme:       p.theme,
      }));

    const avgUpvotes = Math.round(
      posts.reduce((s, p) => s + p.upvotes, 0) / posts.length
    );

    // lastSeen in ms for UI display
    const lastSeen = Math.max(...posts.map(p => p.createdUtc)) * 1000;

    // ── Pre-computed raw metrics for scoring v2 ──────────────────────────────
    // Computed here while we have the full post array.
    // Scoring stage receives these values — not the raw posts.

    // Subreddit spread: distinct subreddits mentioning this ticker
    const uniqueSubreddits = [...new Set(posts.map(p => p.subreddit))].sort();

    // Mention timestamps (seconds, sorted ASC): used for consistency scoring
    const mentionTimes = posts.map(p => p.createdUtc).sort((a, b) => a - b);

    // Body lengths: proxy for discussion depth (chars)
    const bodyLengths = posts.map(p => (p.body ?? "").length);

    // Per-post comment/upvote ratio: high = engaged discussion, capped at 5x
    const engagementRatios = posts.map(p => {
      if (!p.upvotes || p.upvotes <= 0) return 0;
      return Math.min(p.numComments / p.upvotes, 5);
    });

    return {
      ticker,
      mentions,
      velocity,
      avgUpvotes,
      lastSeen,
      samplePosts,
      postCount:        posts.length,
      // v2 scoring inputs
      uniqueSubreddits,
      mentionTimes,
      bodyLengths,
      engagementRatios,
    };
  });
}
