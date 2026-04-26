// /lib/pipeline/themeSearch.js
//
// Executes the query plan produced by themeExpander.buildQueryPlan().
// This module does NOT generate queries — it only executes them.
//
// Guardrails enforced at execution time:
//   - Post-level global deduplication (same post ID across queries)
//   - Per-query yield classification (high / normal / low)
//   - Request jitter (deterministic, not random)
//   - HTTP error handling without aborting the run
//   - Post quality pre-filter before returning
//
// All per-run limits (maxQueriesPerRun, maxPostsPerQuery, etc.) are read
// from searchGuardrails.SEARCH_BUDGET — never defined here.

import { importRawPost }                             from "./post.js";
import { SEARCH_BUDGET, classifyYield }              from "./searchGuardrails.js";
import {
  createSearchRunLog,
  logQueryResult,
  finalizeSearchRunLog,
  storeSearchRunLog,
  summarizeSearchRunLog,
}                                                    from "./searchLog.js";
import { queryFingerprint }                          from "./searchGuardrails.js";

const USER_AGENT    = "DraftBoard/2.0 theme-search";
const FETCH_TIMEOUT = 8000; // ms

// ─── Single query executor ────────────────────────────────────────────────────

/**
 * Execute one search query across all configured subreddits.
 * Returns shaped Post objects that passed importRawPost() quality checks.
 *
 * @param {string}   query    — search query string
 * @param {string}   theme    — originating theme (for post tagging)
 * @param {Set}      globalSeen — post IDs already seen in this run
 * @returns {Promise<{
 *   posts:     Post[],
 *   fetched:   number,
 *   kept:      number,
 *   duped:     number,
 *   httpStatus: number|null,
 *   error:     string|null,
 *   durationMs: number,
 * }>}
 */
async function executeQuery(query, theme, globalSeen) {
  const startedAt  = Date.now();
  let   allRaw     = [];
  let   httpStatus = null;
  let   error      = null;

  // Search all configured subreddits in parallel
  const subResults = await Promise.allSettled(
    SEARCH_BUDGET.subreddits.map(sub => searchSubreddit(sub, query))
  );

  for (const result of subResults) {
    if (result.status === "fulfilled") {
      httpStatus = result.value.status;
      allRaw.push(...result.value.posts);
    } else {
      error = result.reason?.message ?? "unknown error";
    }
  }

  const fetched = allRaw.length;

  // Shape raw API objects into canonical Posts
  // importRawPost() enforces quality thresholds (min title length, age, etc.)
  const shaped = [];
  for (const { raw, subreddit } of allRaw) {
    const post = importRawPost(raw, subreddit, "theme", theme);
    if (post) shaped.push(post);
  }

  // Global deduplication — drop posts already seen from another query
  const kept  = [];
  let   duped = 0;

  for (const post of shaped) {
    if (globalSeen.has(post.id)) {
      duped++;
    } else {
      globalSeen.add(post.id);
      kept.push(post);
    }
  }

  return {
    posts:      kept,
    fetched,
    kept:       kept.length,
    duped,
    filtered:   shaped.length - kept.length,
    httpStatus,
    error,
    durationMs: Date.now() - startedAt,
  };
}

// ─── Single subreddit search ──────────────────────────────────────────────────

/**
 * Search one subreddit for a query string using Reddit's public JSON API.
 *
 * @param {string} subreddit
 * @param {string} query
 * @returns {Promise<{ posts: Array<{raw, subreddit}>, status: number }>}
 */
async function searchSubreddit(subreddit, query) {
  const params = new URLSearchParams({
    q:           query,
    sort:        SEARCH_BUDGET.sort,
    t:           SEARCH_BUDGET.timeFilter,
    limit:       String(SEARCH_BUDGET.maxPostsPerQueryPerSub),
    raw_json:    "1",
    restrict_sr: "1",
  });

  const url = `https://www.reddit.com/r/${subreddit}/search.json?${params}`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal:  AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!res.ok) {
    return { posts: [], status: res.status };
  }

  const json     = await res.json();
  const children = json?.data?.children || [];

  return {
    posts:  children.map(c => ({ raw: c.data, subreddit })),
    status: res.status,
  };
}

// ─── Deterministic jitter ─────────────────────────────────────────────────────
// Fixed delay between requests. Not random — same delay every time.
// This is intentional: determinism matters more than IP rotation here.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Execute a validated query plan, enforcing all search guardrails at runtime.
 *
 * @param {string[]} themes
 * @param {Array<{ theme: string, query: string, source: string }>} plan
 * @param {object}   planMeta — { slotAllocation, violations } from buildQueryPlan
 * @param {string}   runId    — pipeline run identifier for logging
 * @returns {Promise<{
 *   allPosts:      Post[],
 *   themedBatches: Array<{ theme, query, posts }>,
 *   runLog:        SearchRunLog,
 *   meta:          object,
 * }>}
 */
export async function executeQueryPlan(themes, plan, planMeta = {}, runId = "unknown") {
  const startTime = Date.now();
  const runLog    = createSearchRunLog(runId, themes);

  runLog.slotAllocation   = planMeta.slotAllocation ?? {};
  runLog.queriesPlanned   = plan.length;
  runLog.violations       = planMeta.violations ?? [];

  // Guard: if plan is empty or has violations, return early
  if (plan.length === 0) {
    console.warn("[themeSearch] Empty query plan — skipping execution");
    finalizeSearchRunLog(runLog);
    storeSearchRunLog(runLog);
    return { allPosts: [], themedBatches: [], runLog, meta: { durationMs: 0, queries: 0, posts: 0 } };
  }

  const globalSeen   = new Set(); // post IDs seen across all queries this run
  const themedBatches = [];       // per-query result batches
  const allPosts     = [];        // flat deduped post list

  // Execute queries sequentially with jitter between each.
  // Sequential (not parallel) to be respectful of Reddit's public API
  // and to allow globalSeen deduplication to work correctly.
  for (let i = 0; i < plan.length; i++) {
    const { theme, query, source } = plan[i];
    const fp = queryFingerprint(query);

    const result = await executeQuery(query, theme, globalSeen);

    // Build QueryLog entry
    const queryLog = {
      theme,
      query,
      source,
      fingerprint:         fp,
      fetched:             result.fetched,
      afterGlobalDedup:    result.kept + result.filtered,
      afterQualityFilter:  result.kept,
      yieldClass:          classifyYield(result.kept),
      durationMs:          result.durationMs,
      httpStatus:          result.httpStatus,
      error:               result.error ?? null,
    };

    logQueryResult(runLog, queryLog);

    // Accumulate results
    allPosts.push(...result.posts);
    themedBatches.push({ theme, query, source, posts: result.posts });

    console.log(
      `[themeSearch] "${query}" (${theme}) → ` +
      `fetched=${result.fetched} kept=${result.kept} ` +
      `duped=${result.duped} yield=${queryLog.yieldClass} ` +
      `${result.durationMs}ms`
    );

    // Jitter between requests — skip after the last query
    if (i < plan.length - 1) {
      await sleep(SEARCH_BUDGET.requestJitterMs);
    }
  }

  finalizeSearchRunLog(runLog);
  storeSearchRunLog(runLog);

  const summary = summarizeSearchRunLog(runLog);
  console.log(summary);

  const meta = {
    durationMs:  Date.now() - startTime,
    queries:     plan.length,
    queryPlan:   plan,
    posts:       allPosts.length,
    themes:      [...new Set(plan.map(p => p.theme))],
    subreddits:  SEARCH_BUDGET.subreddits,
  };

  return { allPosts, themedBatches, runLog, meta };
}

/**
 * High-level convenience function.
 * Builds a query plan from themes and executes it in one call.
 * Used by ingest.js.
 *
 * @param {string[]} themes
 * @param {number[]} themeScores — optional, for coverage weighting
 * @param {string}   runId
 * @returns {Promise<{ allPosts, themedBatches, runLog, meta }>}
 */
export async function fetchThemePosts(themes, themeScores = [], runId = "unknown") {
  // Import here to avoid circular dependency (themeExpander imports searchGuardrails,
  // themeSearch must not import themeExpander at module level)
  const { buildQueryPlan } = await import("./themeExpander.js");

  const { plan, slotAllocation, violations } = await buildQueryPlan(
    themes,
    themeScores,
    { useAI: true }
  );

  return executeQueryPlan(themes, plan, { slotAllocation, violations }, runId);
}
