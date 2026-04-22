// /lib/pipeline/ingest.js
// Stage 1: Reddit ingestion.
//
// Two sources run in parallel:
//   A — Hot feed sweep  (broad, catches trending posts)
//   B — Theme search    (targeted, higher signal density)
//
// All raw Reddit data passes through importRawPost() before entering the
// pipeline — no raw API objects survive past this stage.

import { fetchThemePosts }          from "./themeSearch.js";
import { importRawPost }            from "./post.js";
import { edgeLog, clearEdgeLog }    from "./edgeLog.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const SUBREDDITS     = ["wallstreetbets", "stocks", "investing"];
const POST_LIMIT     = 75;
const SORT           = "hot";
const DEFAULT_THEMES = ["AI", "oil", "interest rates", "crypto"];
const USER_AGENT     = "DraftBoard/2.0 discovery-pipeline";
const FETCH_TIMEOUT  = 8000; // ms

// ─── Single subreddit fetch ───────────────────────────────────────────────────

/**
 * Fetch and shape posts from one subreddit.
 * Returns only posts that pass importRawPost() quality checks.
 *
 * @param {string} sub
 * @param {string} source — "hot" | "search"
 * @param {string|null} theme
 * @returns {Promise<Post[]>}
 */
async function fetchSubreddit(sub, source = "hot", theme = null) {
  const url = `https://www.reddit.com/r/${sub}/${SORT}.json?limit=${POST_LIMIT}&raw_json=1`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT),
    });

    if (!res.ok) {
      edgeLog("ingest", "http_error", { sub, status: res.status });
      return [];
    }

    const json     = await res.json();
    const children = json?.data?.children || [];

    const posts = [];
    for (const child of children) {
      const post = importRawPost(child.data, sub, source, theme);
      if (post) posts.push(post);
    }

    return posts;

  } catch (e) {
    edgeLog("ingest", "fetch_failed", { sub, error: e.message });
    return [];
  }
}

// ─── Main batch ───────────────────────────────────────────────────────────────

/**
 * Run a full ingestion batch — hot feed + theme search, merged and deduped.
 *
 * @param {object}   options
 * @param {string[]} options.themes      — themes for targeted search
 * @param {boolean}  options.skipThemes  — disable theme search (hot-only mode)
 * @returns {Promise<{ posts: Post[], themedBatches: object[], meta: object }>}
 */
export async function fetchRedditBatch({
  themes     = DEFAULT_THEMES,
  skipThemes = false,
} = {}) {
  clearEdgeLog();
  const startTime = Date.now();

  // Run both sources in parallel
  const [hotResults, themeResult] = await Promise.all([
    Promise.allSettled(SUBREDDITS.map(sub => fetchSubreddit(sub, "hot"))),
    skipThemes
      ? Promise.resolve({ allPosts: [], themedBatches: [], meta: { queries: 0, posts: 0 } })
      : fetchThemePosts(themes),
  ]);

  // Collect hot posts
  const hotPosts     = [];
  const perSubreddit = {};

  hotResults.forEach((result, i) => {
    const sub = SUBREDDITS[i];
    if (result.status === "fulfilled") {
      perSubreddit[sub] = result.value.length;
      hotPosts.push(...result.value);
    } else {
      perSubreddit[sub] = 0;
      edgeLog("ingest", "subreddit_failed", { sub, reason: result.reason?.message });
    }
  });

  // Theme posts are already shaped by themeSearch → importRawPost
  const themePosts = themeResult.allPosts || [];

  // Global deduplication by post ID
  const seen   = new Set();
  const unique = [...hotPosts, ...themePosts].filter(p => {
    if (seen.has(p.id)) {
      edgeLog("ingest", "duplicate_id", { id: p.id });
      return false;
    }
    seen.add(p.id);
    return true;
  });

  const meta = {
    timestamp:    Date.now(),
    durationMs:   Date.now() - startTime,
    totalPosts:   unique.length,
    hotPosts:     hotPosts.length,
    themePosts:   themePosts.length,
    dedupedOut:   (hotPosts.length + themePosts.length) - unique.length,
    perSubreddit,
    subreddits:   SUBREDDITS,
    themeSearch:  themeResult.meta,
  };

  console.log(
    `[ingest] ${unique.length} posts — ` +
    `${hotPosts.length} hot, ${themePosts.length} themed, ` +
    `${meta.dedupedOut} dupes removed — ${meta.durationMs}ms`
  );

  return {
    posts:         unique,
    themedBatches: themeResult.themedBatches || [],
    meta,
  };
}
