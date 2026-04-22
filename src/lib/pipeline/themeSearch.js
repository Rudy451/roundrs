//
// Executes targeted Reddit search queries for given themes.
// Returns posts tagged with their originating theme + query.
// Plugs into fetchRedditBatch() as an additive source.
//
// Uses Reddit's public search endpoint - no API key required.
// Rate-limit aware: sequential execution with jitter between calls.

import { expandThemes } from "./themeExpander.js";

const SEARCH_SUBREDDITS = ["stocks", "investing", "wallstreetbets"];
const POSTS_PER_QUERY = 15; // per subreddit per query - keeps total volume sane
const SORT = "relevance"; // "relevance" | "new" | "hot" | "top"
const TIME_FILTER = "week"; // "hour"|"day"|"week"|"month"|"year"|"all"
const REQUEST_JITTER_MS = 400; // ms between requests - avoids rate limiting
const USER_AGENT = "DraftBoard/2.0 theme-search (automated research tool)";

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Search a single subreddit for a query string.
 * @param {string} subreddit
 * @param {string} query
 * @returns {Promise<Post[]>}
 */
async function searchSubreddit(subreddit, query) {
  const params = new URLSearchParams({
    q: query,
    sort: SORT,
    t: TIME_FILTER,
    limit: String(POSTS_PER_QUERY),
    raw_json: "1",
    restrict_sr: "1",
  });

  const url = `https://www.reddit.com/r/${subreddit}/search.json?${params}`;
  const { signal, cleanup } = createTimeoutSignal(8000);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal,
    });

    if (!res.ok) {
      console.warn(`[themeSearch] r/${subreddit} search "${query}" -> HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();

    return (json?.data?.children || []).map((child) => {
      const data = child.data;
      return {
        id: data.id,
        subreddit,
        title: data.title || "",
        body: data.selftext || "",
        score: data.score || 0,
        created_utc: data.created_utc || Math.floor(Date.now() / 1000),
        url: `https://reddit.com${data.permalink}`,
        num_comments: data.num_comments || 0,
      };
    });
  } catch (e) {
    console.error(`[themeSearch] Failed r/${subreddit} "${query}":`, e.message);
    return [];
  } finally {
    cleanup();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run theme-targeted Reddit searches for a list of themes.
 *
 * Execution model:
 *   - Expand themes -> queries (capped at 5 by expandThemes)
 *   - For each query: search all SEARCH_SUBREDDITS in parallel
 *   - Add jitter between queries to avoid rate limits
 *   - Deduplicate posts by ID across all results
 *
 * @param {string[]} themes e.g. ["AI", "oil", "interest rates"]
 * @returns {Promise<{
 *   themedBatches: Array<{ theme: string, query: string, posts: Post[] }>,
 *   allPosts:      Post[],
 *   meta:          ThemeSearchMeta
 * }>}
 */
export async function fetchThemePosts(themes) {
  if (!themes || themes.length === 0) {
    return { themedBatches: [], allPosts: [], meta: { queries: 0, posts: 0, themes: [] } };
  }

  const startTime = Date.now();
  const queryPlan = expandThemes(themes);
  const themedBatches = [];
  const globalSeen = new Set();
  let totalPosts = 0;

  console.log(`[themeSearch] Running ${queryPlan.length} queries for themes: ${themes.join(", ")}`);

  for (let i = 0; i < queryPlan.length; i++) {
    const { theme, query } = queryPlan[i];

    const subResults = await Promise.allSettled(
      SEARCH_SUBREDDITS.map((subreddit) => searchSubreddit(subreddit, query))
    );

    const posts = [];
    subResults.forEach((result) => {
      if (result.status === "fulfilled") posts.push(...result.value);
    });

    const unique = posts.filter((post) => {
      if (globalSeen.has(post.id)) return false;
      globalSeen.add(post.id);
      return true;
    });

    themedBatches.push({ theme, query, posts: unique });
    totalPosts += unique.length;

    console.log(`[themeSearch] "${query}" (${theme}) -> ${unique.length} posts`);

    if (i < queryPlan.length - 1) {
      await sleep(REQUEST_JITTER_MS + Math.random() * 200);
    }
  }

  const allPosts = themedBatches.flatMap((batch) => batch.posts);

  const meta = {
    durationMs: Date.now() - startTime,
    queries: queryPlan.length,
    queryPlan,
    posts: totalPosts,
    themes: [...new Set(queryPlan.map((item) => item.theme))],
    subreddits: SEARCH_SUBREDDITS,
  };

  console.log(`[themeSearch] Done - ${totalPosts} posts from ${queryPlan.length} queries in ${meta.durationMs}ms`);

  return { themedBatches, allPosts, meta };
}
