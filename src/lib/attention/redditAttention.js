import { themeKeywords } from "../universe/themeMap";

/**
 * Extract ticker mention stats from an array of post objects.
 * Each post: { text: string, timestamp?: number }
 *
 * @param {Array<{text: string, timestamp?: number}>} posts
 * @param {string[]} tickers
 * @returns {Object} stats keyed by ticker
 */
export function extractTickerMentions(posts, tickers) {
  const stats = {};

  tickers.forEach(t => {
    stats[t] = { ticker: t, mentions: 0, velocity: 0, narratives: [], crowding: 0 };
  });

  posts.forEach(post => {
    const text = post.text ?? "";
    tickers.forEach(ticker => {
      // Match ticker as a whole word (e.g. don't match "AMD" inside "AMZN")
      const regex = new RegExp(`\\b${ticker}\\b`, "i");
      if (regex.test(text)) {
        stats[ticker].mentions += 1;

        // Extract narrative keywords present in this post
        Object.entries(themeKeywords).forEach(([, keywords]) => {
          keywords.forEach(kw => {
            if (text.toLowerCase().includes(kw.toLowerCase())) {
              if (!stats[ticker].narratives.includes(kw)) {
                stats[ticker].narratives.push(kw);
              }
            }
          });
        });
      }
    });
  });

  return stats;
}

/**
 * Compute velocity: change in mentions from a previous snapshot to current.
 * @param {{ mentions: number }} prev
 * @param {{ mentions: number }} current
 */
export function computeVelocity(prev, current) {
  return current.mentions - prev.mentions;
}

/**
 * Merge a previous snapshot with current stats to add velocity per ticker.
 * @param {Object} prevStats  — keyed by ticker
 * @param {Object} currStats  — keyed by ticker
 * @returns {Object} currStats with velocity populated
 */
export function applyVelocity(prevStats, currStats) {
  const result = { ...currStats };
  Object.keys(result).forEach(ticker => {
    const prev = prevStats[ticker] ?? { mentions: 0 };
    result[ticker].velocity = computeVelocity(prev, result[ticker]);
  });
  return result;
}
