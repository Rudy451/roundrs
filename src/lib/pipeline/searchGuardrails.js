// /lib/pipeline/searchGuardrails.js
//
// Search guardrail rules for DraftBoard's Reddit discovery layer.
//
// This module owns all constraints on what gets searched, how much,
// and how results are validated. It is imported by themeExpander and
// themeSearch — neither of those modules defines limits themselves.
//
// Single source of truth for:
//   - query budget (max queries per run, per theme)
//   - result limits (max posts per query)
//   - coverage balancing (slots per theme)
//   - query deduplication (fingerprinting)
//   - noise filtering (minimum yield threshold)

// ─── Budget ───────────────────────────────────────────────────────────────────

export const SEARCH_BUDGET = {
  // Hard cap on total queries executed per pipeline run.
  // Across all themes, never more than this.
  maxQueriesPerRun: 10,

  // Maximum queries allocated to any single theme.
  // Prevents one theme consuming the entire budget.
  maxQueriesPerTheme: 3,

  // Minimum queries guaranteed to each theme if budget allows.
  // If 4 themes × 1 min = 4, and budget = 10, remaining 6 are distributed.
  minQueriesPerTheme: 1,

  // Maximum posts fetched per query per subreddit.
  maxPostsPerQueryPerSub: 15,

  // Subreddits searched per query.
  // Total posts per query = maxPostsPerQueryPerSub × subreddits.length
  subreddits: ["stocks", "investing", "wallstreetbets"],

  // Fixed jitter between sequential requests (ms).
  // Deterministic — no Math.random().
  requestJitterMs: 450,

  // Reddit search parameters
  sort:       "relevance",
  timeFilter: "week",
};

// ─── Coverage balancing ───────────────────────────────────────────────────────

/**
 * Allocate query slots across themes fairly.
 *
 * Algorithm:
 *   1. Give each theme its minimum (minQueriesPerTheme)
 *   2. Distribute remaining budget round-robin by theme score (highest first)
 *   3. Never exceed maxQueriesPerTheme for any single theme
 *
 * @param {string[]} themes         — ordered list (highest priority first)
 * @param {number[]} themeScores    — score per theme (index-matched), optional
 * @param {number}   budget         — total queries available
 * @returns {{ [theme: string]: number }} — slot count per theme
 */
export function allocateQuerySlots(themes, themeScores = [], budget = SEARCH_BUDGET.maxQueriesPerRun) {
  if (themes.length === 0) return {};

  const { minQueriesPerTheme, maxQueriesPerTheme } = SEARCH_BUDGET;

  // Sort themes by score descending (fall back to input order if no scores)
  const scored = themes.map((theme, i) => ({
    theme,
    score: themeScores[i] ?? (themes.length - i), // default: preserve input order
  })).sort((a, b) => b.score - a.score);

  // Phase 1: assign minimums
  const slots = {};
  let used = 0;

  for (const { theme } of scored) {
    const min = Math.min(minQueriesPerTheme, budget - used);
    if (min <= 0) break;
    slots[theme] = min;
    used += min;
  }

  // Phase 2: distribute remaining slots round-robin by score
  let remaining = budget - used;
  let passes = 0;
  const maxPasses = maxQueriesPerTheme; // upper bound on rounds

  while (remaining > 0 && passes < maxPasses) {
    let distributed = 0;
    for (const { theme } of scored) {
      if (remaining <= 0) break;
      if ((slots[theme] ?? 0) < maxQueriesPerTheme) {
        slots[theme] = (slots[theme] ?? 0) + 1;
        used++;
        remaining--;
        distributed++;
      }
    }
    if (distributed === 0) break; // all themes at max
    passes++;
  }

  return slots;
}

// ─── Query deduplication ──────────────────────────────────────────────────────

/**
 * Fingerprint a query string for deduplication.
 * Two queries with the same fingerprint are considered equivalent.
 *
 * Strategy: normalize to lowercase, sort words, join.
 * "NVDA AI datacenter" and "AI datacenter NVDA" → same fingerprint.
 *
 * @param {string} query
 * @returns {string}
 */
export function queryFingerprint(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Deduplicate a list of query objects, removing exact and near-duplicate queries.
 *
 * @param {Array<{ theme: string, query: string, source: string }>} queries
 * @returns {Array<{ theme: string, query: string, source: string, dedupedReason?: string }>}
 */
export function deduplicateQueries(queries) {
  const seen       = new Map(); // fingerprint → first query that used it
  const kept       = [];
  const discarded  = [];

  for (const q of queries) {
    const fp = queryFingerprint(q.query);

    if (seen.has(fp)) {
      discarded.push({ ...q, dedupedReason: `duplicate_of: ${seen.get(fp).query}` });
    } else {
      seen.set(fp, q);
      kept.push(q);
    }
  }

  if (discarded.length > 0) {
    console.debug(`[searchGuardrails] Deduped ${discarded.length} queries:`,
      discarded.map(d => d.query));
  }

  return kept;
}

// ─── Result noise filtering ───────────────────────────────────────────────────

// If a query returns fewer than this many posts, log it as low-yield.
// It's not discarded — low yield is itself signal (thin discussion).
export const LOW_YIELD_THRESHOLD = 3;

/**
 * Classify a query result as high, normal, or low yield.
 *
 * @param {number} postCount
 * @returns {"high" | "normal" | "low"}
 */
export function classifyYield(postCount) {
  if (postCount >= 10) return "high";
  if (postCount >= LOW_YIELD_THRESHOLD) return "normal";
  return "low";
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a query plan before execution.
 * Returns an array of violation strings. Empty = valid.
 *
 * @param {Array<{ theme: string, query: string }>} plan
 * @returns {string[]}
 */
export function validateQueryPlan(plan) {
  const errors = [];

  if (plan.length > SEARCH_BUDGET.maxQueriesPerRun) {
    errors.push(`Query count ${plan.length} exceeds maxQueriesPerRun ${SEARCH_BUDGET.maxQueriesPerRun}`);
  }

  // Check per-theme counts
  const perTheme = {};
  for (const { theme } of plan) {
    perTheme[theme] = (perTheme[theme] ?? 0) + 1;
  }
  for (const [theme, count] of Object.entries(perTheme)) {
    if (count > SEARCH_BUDGET.maxQueriesPerTheme) {
      errors.push(`Theme "${theme}" has ${count} queries, exceeds maxQueriesPerTheme ${SEARCH_BUDGET.maxQueriesPerTheme}`);
    }
  }

  // Check for empty queries
  for (const { query } of plan) {
    if (!query || query.trim().length === 0) {
      errors.push("Empty query in plan");
    }
  }

  return errors;
}
