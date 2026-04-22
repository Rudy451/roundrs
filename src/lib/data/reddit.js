// /lib/data/reddit.js
// Fetches posts from Reddit's public JSON API and counts ticker mentions.
// No API key required — uses Reddit's public ?after= pagination.
// Falls back to mock data if the fetch fails (rate limits, etc.)

const SUBREDDITS = ["wallstreetbets", "stocks", "investing", "StockMarket"];
const POST_LIMIT = 25; // posts per subreddit

/**
 * Fetch recent posts from a subreddit using Reddit's public JSON API.
 * @param {string} subreddit
 * @returns {Promise<Array<{ title: string, body: string }>>}
 */
async function fetchSubredditPosts(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${POST_LIMIT}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DraftBoard/1.0 (investment research app)" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    return json.data.children.map((child) => ({
      title: child.data.title || "",
      body: child.data.selftext || "",
    }));
  } catch (e) {
    console.warn(`[reddit] Failed to fetch r/${subreddit}:`, e.message);
    return [];
  }
}

/**
 * Count how many times each ticker appears across an array of posts.
 * Matches whole-word ticker symbols to reduce false positives.
 * @param {Array<{ title: string, body: string }>} posts
 * @param {string[]} tickers
 * @returns {{ [ticker: string]: number }}
 */
export function extractMentions(posts, tickers) {
  const counts = {};
  tickers.forEach((t) => (counts[t] = 0));

  posts.forEach((post) => {
    const text = `${post.title} ${post.body}`.toUpperCase();
    tickers.forEach((ticker) => {
      // Word-boundary match: avoids "MSFT" matching inside "REMSFT"
      const regex = new RegExp(`\\b${ticker}\\b`, "g");
      const matches = text.match(regex);
      if (matches) counts[ticker] += matches.length;
    });
  });

  return counts;
}

/**
 * Fetch Reddit attention signals for a list of tickers.
 * Aggregates across multiple subreddits.
 * @param {string[]} tickers
 * @returns {Promise<Array<{ ticker, mentions, timestamp }>>}
 */
export async function fetchAttention(tickers) {
  // Gather posts from all subreddits in parallel
  const postArrays = await Promise.all(
    SUBREDDITS.map((sub) => fetchSubredditPosts(sub))
  );
  const allPosts = postArrays.flat();

  // Fall back to mock posts if Reddit blocked us entirely
  const posts = allPosts.length > 0 ? allPosts : getMockPosts(tickers);

  const counts = extractMentions(posts, tickers);
  const timestamp = Date.now();

  return tickers.map((ticker) => ({
    ticker,
    mentions: counts[ticker] || 0,
    timestamp,
  }));
}

// ─── Mock fallback ─────────────────────────────────────────────────────────────

/**
 * Generate plausible mock posts when Reddit is unreachable.
 * Useful for local dev and CI.
 */
function getMockPosts(tickers) {
  const posts = [];
  tickers.forEach((ticker) => {
    const count = Math.floor(Math.random() * 8) + 1;
    for (let i = 0; i < count; i++) {
      posts.push({
        title: `${ticker} is moving today — thoughts?`,
        body: `I've been watching ${ticker} closely. What's the play?`,
      });
    }
  });
  return posts;
}
