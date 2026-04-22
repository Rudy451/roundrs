// /lib/pipeline/ingest.js
// Stage 1: Automated Reddit ingestion.
// Merges two complementary sources:
//
//   SOURCE A - Hot feed sweep (broad, high-volume, catches trending posts)
//   SOURCE B - Theme-targeted search (focused, higher signal density per call)
//
// Both sources feed into a single deduped Post[] for downstream processing.
// Theme search is additive - hot feed always runs even if no themes supplied.

import { fetchThemePosts } from "./themeSearch.js";

const SUBREDDITS = ["wallstreetbets", "stocks", "investing"];
const POST_LIMIT = 75; // per subreddit - stays well within public API limits
const SORT = "hot";

const USER_AGENT = "DraftBoard/2.0 discovery-pipeline (automated research tool)";

// Default active themes
// Override by passing themes[] to fetchRedditBatch().
// Keep this list short - each theme costs ~3 search requests (one per subreddit).
const DEFAULT_THEMES = ["AI", "oil", "interest rates", "crypto"];

// Hot feed fetch
function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

function createRequestOptions(timeoutMs, headers = {}) {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  return {
    options: {
      headers,
      signal,
    },
    cleanup,
  };
}

/**
 * Fetch hot posts from a single subreddit.
 * @param {string} sub
 * @returns {Promise<Post[]>}
 */
async function fetchSubreddit(sub) {
  const url = `https://www.reddit.com/r/${sub}/${SORT}.json?limit=${POST_LIMIT}&raw_json=1`;
  const { options, cleanup } = createRequestOptions(8000, { "User-Agent": USER_AGENT });

  try {
    const res = await fetch(url, options);

    if (!res.ok) {
      console.warn(`[ingest] r/${sub} returned HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();

    return (json?.data?.children || []).map((child) => {
      const data = child.data;
      return {
        id: data.id,
        subreddit: sub,
        title: data.title || "",
        body: data.selftext || "",
        score: data.score || 0,
        created_utc: data.created_utc || Math.floor(Date.now() / 1000),
        url: `https://reddit.com${data.permalink}`,
        num_comments: data.num_comments || 0,
        source: "hot",
        theme: null,
      };
    });
  } catch (e) {
    console.error(`[ingest] Failed to fetch r/${sub}:`, e.message);
    return [];
  } finally {
    cleanup();
  }
}

// Main batch function
/**
 * Run a full ingestion batch - hot feed + theme-targeted search.
 * One call = one complete batch. Designed to run every 15-60 minutes.
 *
 * @param {object}   options
 * @param {string[]} options.themes      - themes to search (default: DEFAULT_THEMES)
 * @param {boolean}  options.skipThemes  - disable theme search entirely (hot-only mode)
 * @returns {Promise<{
 *   posts:         Post[],
 *   themedBatches: Array<{ theme, query, posts }>,
 *   meta:          IngestMeta
 * }>}
 */
export async function fetchRedditBatch({
  themes = DEFAULT_THEMES,
  skipThemes = false,
} = {}) {
  const startTime = Date.now();

  // SOURCE A: Hot feed + SOURCE B: Theme search - run in parallel
  const [hotResults, themeResult] = await Promise.all([
    Promise.allSettled(SUBREDDITS.map((sub) => fetchSubreddit(sub))),
    skipThemes
      ? Promise.resolve({ allPosts: [], themedBatches: [], meta: { queries: 0, posts: 0 } })
      : fetchThemePosts(themes),
  ]);

  // Collect hot posts
  const hotPosts = [];
  const perSubreddit = {};

  hotResults.forEach((result, index) => {
    const sub = SUBREDDITS[index];
    if (result.status === "fulfilled") {
      perSubreddit[sub] = result.value.length;
      hotPosts.push(...result.value);
    } else {
      perSubreddit[sub] = 0;
      console.warn(`[ingest] r/${sub} hot feed failed:`, result.reason);
    }
  });

  // Tag theme posts with source metadata
  const themePosts = themeResult.allPosts.map((post) => ({
    ...post,
    source: "theme",
  }));

  // Merge + global deduplicate
  const seen = new Set();
  const allRaw = [...hotPosts, ...themePosts];
  const unique = allRaw.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });

  // Build meta
  const meta = {
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
    totalPosts: unique.length,
    hotPosts: hotPosts.length,
    themePosts: themePosts.length,
    dedupedOut: allRaw.length - unique.length,
    perSubreddit,
    subreddits: SUBREDDITS,
    sort: SORT,
    themeSearch: themeResult.meta,
  };

  console.log(
    `[ingest] ${unique.length} total posts - ` +
    `${hotPosts.length} hot, ${themePosts.length} themed ` +
    `(${meta.dedupedOut} dupes removed) in ${meta.durationMs}ms`
  );

  return {
    posts: unique,
    themedBatches: themeResult.themedBatches,
    meta,
  };
}
