// /lib/pipeline/guardrails.js
//
// System guardrails for DraftBoard.
//
// Three domains:
//   SEARCH   — prevents query explosion and theme boundary drift
//   SCORING  — locks scoring formula ranges, prevents runaway weights
//   OUTPUT   — enforces top-N constraints, prevents over-dense outputs
//
// Design principles:
//   - Guardrails are ADDITIVE: they reject or clamp inputs without
//     changing the pipeline's design flexibility.
//   - All limits live here. No pipeline stage defines its own caps.
//   - Same input → same guardrail decision (deterministic).
//   - Violations are logged and reported; they never silently pass.
//
// Usage:
//   import { GUARDRAILS, assertSearch, assertScoring, assertOutput } from "./guardrails.js";
//
//   // At the start of a stage, assert that its inputs are within bounds:
//   const check = assertSearch({ themes, plan });
//   if (!check.ok) { console.warn(check.violations); /* abort or clamp */ }

// ─── Master config ────────────────────────────────────────────────────────────
//
// All numeric limits in one place.
// Change a limit here; every enforcement point picks it up automatically.

export const GUARDRAILS = {

  // ── Search guardrails ──────────────────────────────────────────────────────

  search: {
    // Maximum distinct themes active in a single pipeline run.
    // Above this, additional themes are dropped (lowest-score first).
    maxThemesPerRun: 8,

    // Hard ceiling on total queries executed per run, across all themes.
    // Mirrors SEARCH_BUDGET.maxQueriesPerRun but owned here for cross-checking.
    maxQueriesPerRun: 10,

    // Maximum queries per theme (mirrors SEARCH_BUDGET.maxQueriesPerTheme).
    maxQueriesPerTheme: 3,

    // Minimum characters in a query string.
    // Catches empty or near-empty queries before they hit Reddit.
    minQueryLength: 8,

    // Maximum characters in a query string.
    // Extremely long queries are usually AI hallucinations.
    maxQueryLength: 120,

    // Minimum theme name length (prevents empty strings).
    minThemeLength: 2,

    // Maximum theme name length (prevents paragraph-length "themes").
    maxThemeLength: 50,

    // Maximum duplicate (fingerprint-matched) queries allowed before the
    // deduplication step is considered to have failed.
    // If this many dupes are detected, it signals the expander is looping.
    maxDuplicateQueriesAllowed: 6,
  },

  // ── Scoring guardrails ─────────────────────────────────────────────────────

  scoring: {
    // BASE_WEIGHTS must sum to exactly 1.0 (±tolerance).
    baseWeightSum:           1.0,
    baseWeightSumTolerance:  0.001,

    // Individual base weight bounds.
    // Any single weight outside [min, max] indicates misconfiguration.
    baseWeightMin:  0.10,  // no component should be less than 10%
    baseWeightMax:  0.65,  // no component should dominate above 65%

    // MODIFIER_WEIGHTS: each modifier shifts the base score by this fraction.
    // Individual modifier bounds.
    modifierWeightMin: 0.05,
    modifierWeightMax: 0.30,

    // PENALTY caps: how many points each penalty class may subtract.
    // If a computed penalty exceeds the cap, it is clamped.
    maxSpikePenalty:      20,
    maxLowQualityPenalty: 15,
    maxTotalPenalty:      35,  // combined penalty floor (spike + lowQuality)

    // Score range: finalScore must always fall within [floor, ceiling].
    scoreCeiling: 100,
    scoreFloor:   5,

    // Velocity multipliers: the velocity component of base score must
    // fall within this range (prevents a single velocity spike flooding
    // the final score).
    velocityScoreMin: 0,
    velocityScoreMax: 100,

    // Max number of tickers passed into prioritizeSignals() per run.
    // If more arrive, the top N by raw mentions are used.
    maxTickersForScoring: 150,
  },

  // ── Output guardrails ──────────────────────────────────────────────────────

  output: {
    // Maximum candidates in the shortlist (mirrors FILTER_CONFIG.maxCandidates).
    maxCandidates: 10,

    // Minimum adjusted score to appear in the shortlist output.
    // Mirrors FILTER_CONFIG.minAdjustedScore.
    minAdjustedScore: 35,

    // Maximum candidates that may share the same ticker symbol.
    // Should always be 1 — deduplication should prevent this, but
    // this is a final safety net.
    maxDuplicateTickers: 1,

    // Maximum length of narrativeSummary (characters).
    // Claude sometimes returns run-on summaries; truncate at this length.
    maxNarrativeLength: 400,

    // Maximum length of keyCatalyst / keyRisk fields.
    maxCatalystLength: 200,

    // Minimum mentions for a ticker to survive into the output.
    // Prevents singletons from reaching users.
    minMentionsForOutput: 1,

    // Maximum number of excluded tickers returned in the excluded list.
    // Keeps API payloads bounded.
    maxExcludedReturned: 50,

    // Maximum total tickers (candidates + excluded) per PipelineResult.
    // If more are present, the lowest-scoring excess are dropped.
    maxTotalOutputTickers: 60,

    // samplePosts limit per output candidate.
    // More than 3 adds payload weight with no user-visible benefit.
    maxSamplePostsPerCandidate: 3,
  },
};

// ─── Violation record ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} GuardrailViolation
 * @property {string}  domain   — "search" | "scoring" | "output"
 * @property {string}  rule     — identifier, e.g. "maxQueriesPerRun"
 * @property {string}  message  — human-readable description
 * @property {*}       actual   — the value that violated the rule
 * @property {*}       limit    — the guardrail limit
 * @property {string}  action   — "blocked" | "clamped" | "warned"
 */

/**
 * @typedef {Object} GuardrailResult
 * @property {boolean}              ok          — true if no blocking violations
 * @property {GuardrailViolation[]} violations  — all violations found
 * @property {object|null}          clamped     — clamped version of input (if applicable)
 */

function violation(domain, rule, message, actual, limit, action = "blocked") {
  return { domain, rule, message, actual, limit, action };
}

// ─── DOMAIN 1: Search guardrails ──────────────────────────────────────────────

/**
 * Assert that a search configuration is within guardrail bounds.
 *
 * Checks:
 *   - theme count and name lengths
 *   - total query count
 *   - per-theme query counts
 *   - individual query string lengths
 *   - duplicate query count
 *
 * @param {object}   input
 * @param {string[]} input.themes        — theme names for this run
 * @param {Array<{theme,query}>} input.plan — query plan (after expansion + dedup)
 * @param {number}   input.duplicates    — count of deduped queries (from deduplicateQueries)
 * @returns {GuardrailResult}
 */
export function assertSearch({ themes = [], plan = [], duplicates = 0 } = {}) {
  const g           = GUARDRAILS.search;
  const violations  = [];

  // ── Theme count ────────────────────────────────────────────────────────────
  if (themes.length > g.maxThemesPerRun) {
    violations.push(violation(
      "search", "maxThemesPerRun",
      `${themes.length} themes requested; max is ${g.maxThemesPerRun}. Excess themes will be dropped.`,
      themes.length, g.maxThemesPerRun, "clamped"
    ));
  }

  // ── Theme name lengths ─────────────────────────────────────────────────────
  for (const theme of themes) {
    if (typeof theme !== "string" || theme.trim().length < g.minThemeLength) {
      violations.push(violation(
        "search", "minThemeLength",
        `Theme "${theme}" is too short (min ${g.minThemeLength} chars).`,
        theme?.length ?? 0, g.minThemeLength, "blocked"
      ));
    }
    if (typeof theme === "string" && theme.length > g.maxThemeLength) {
      violations.push(violation(
        "search", "maxThemeLength",
        `Theme "${theme.slice(0, 30)}…" exceeds max length (${g.maxThemeLength} chars).`,
        theme.length, g.maxThemeLength, "clamped"
      ));
    }
  }

  // ── Total query count ──────────────────────────────────────────────────────
  if (plan.length > g.maxQueriesPerRun) {
    violations.push(violation(
      "search", "maxQueriesPerRun",
      `Query plan has ${plan.length} queries; max is ${g.maxQueriesPerRun}. Excess will be dropped.`,
      plan.length, g.maxQueriesPerRun, "clamped"
    ));
  }

  // ── Per-theme query counts ─────────────────────────────────────────────────
  const perTheme = {};
  for (const { theme } of plan) {
    perTheme[theme] = (perTheme[theme] ?? 0) + 1;
  }
  for (const [theme, count] of Object.entries(perTheme)) {
    if (count > g.maxQueriesPerTheme) {
      violations.push(violation(
        "search", "maxQueriesPerTheme",
        `Theme "${theme}" has ${count} queries; max is ${g.maxQueriesPerTheme}.`,
        count, g.maxQueriesPerTheme, "clamped"
      ));
    }
  }

  // ── Individual query string lengths ───────────────────────────────────────
  for (const { query } of plan) {
    if (!query || query.trim().length < g.minQueryLength) {
      violations.push(violation(
        "search", "minQueryLength",
        `Query "${(query ?? "").slice(0, 30)}" is too short (min ${g.minQueryLength} chars).`,
        (query ?? "").length, g.minQueryLength, "blocked"
      ));
    }
    if (query && query.length > g.maxQueryLength) {
      violations.push(violation(
        "search", "maxQueryLength",
        `Query "${query.slice(0, 40)}…" exceeds max length (${g.maxQueryLength} chars).`,
        query.length, g.maxQueryLength, "clamped"
      ));
    }
  }

  // ── Duplicate query explosion ──────────────────────────────────────────────
  if (duplicates > g.maxDuplicateQueriesAllowed) {
    violations.push(violation(
      "search", "maxDuplicateQueriesAllowed",
      `${duplicates} duplicate queries detected; max allowed is ${g.maxDuplicateQueriesAllowed}. ` +
      `This may indicate the theme expander is looping or repeating patterns.`,
      duplicates, g.maxDuplicateQueriesAllowed, "warned"
    ));
  }

  // ── Clamped plan ───────────────────────────────────────────────────────────
  // Return a safe version of the plan regardless of violations.
  const clampedThemes = themes.slice(0, g.maxThemesPerRun);
  const clampedPlan   = enforcePlanBudget(plan, g);

  const blocking = violations.filter(v => v.action === "blocked");

  return {
    ok:         blocking.length === 0,
    violations,
    clamped: {
      themes:     clampedThemes,
      plan:       clampedPlan,
      duplicates,
    },
  };
}

/**
 * Enforce per-theme and total query budget on a plan array.
 * Returns a new array with excess queries removed (lowest-priority themes cut first).
 *
 * @param {Array<{theme,query,source}>} plan
 * @param {object} g — search guardrail config
 * @returns {Array}
 */
function enforcePlanBudget(plan, g) {
  const perThemeCount = {};
  const kept          = [];

  for (const item of plan) {
    if (kept.length >= g.maxQueriesPerRun) break;

    const theme = item.theme ?? "unknown";
    const count = perThemeCount[theme] ?? 0;

    if (count >= g.maxQueriesPerTheme) continue;
    if (!item.query || item.query.length < g.minQueryLength) continue;

    const q = item.query.length > g.maxQueryLength
      ? { ...item, query: item.query.slice(0, g.maxQueryLength) }
      : item;

    kept.push(q);
    perThemeCount[theme] = count + 1;
  }

  return kept;
}

// ─── DOMAIN 2: Scoring guardrails ─────────────────────────────────────────────

/**
 * Assert that scoring weights and config are within guardrail bounds.
 *
 * Checks:
 *   - BASE_WEIGHTS sum to 1.0
 *   - Each base weight is within [min, max]
 *   - Each modifier weight is within [min, max]
 *   - Penalty caps do not exceed maximums
 *
 * Call this once at module load time in prioritize.js.
 *
 * @param {object} input
 * @param {object} input.baseWeights      — { mentions, velocity, theme }
 * @param {object} input.modifierWeights  — { concentration, consistency, quality }
 * @param {object} input.penaltyCaps      — { spike, lowQuality }
 * @returns {GuardrailResult}
 */
export function assertScoring({ baseWeights = {}, modifierWeights = {}, penaltyCaps = {} } = {}) {
  const g          = GUARDRAILS.scoring;
  const violations = [];

  // ── Base weight sum ────────────────────────────────────────────────────────
  const baseSum = Object.values(baseWeights).reduce((s, v) => s + v, 0);
  if (Math.abs(baseSum - g.baseWeightSum) > g.baseWeightSumTolerance) {
    violations.push(violation(
      "scoring", "baseWeightSum",
      `BASE_WEIGHTS sum to ${baseSum.toFixed(4)}, expected ${g.baseWeightSum} ±${g.baseWeightSumTolerance}. ` +
      `Scoring results will be incorrect.`,
      baseSum, g.baseWeightSum, "blocked"
    ));
  }

  // ── Individual base weight bounds ──────────────────────────────────────────
  for (const [key, value] of Object.entries(baseWeights)) {
    if (value < g.baseWeightMin) {
      violations.push(violation(
        "scoring", "baseWeightMin",
        `BASE_WEIGHTS.${key} = ${value} is below minimum ${g.baseWeightMin}. ` +
        `This dimension would have negligible effect.`,
        value, g.baseWeightMin, "warned"
      ));
    }
    if (value > g.baseWeightMax) {
      violations.push(violation(
        "scoring", "baseWeightMax",
        `BASE_WEIGHTS.${key} = ${value} exceeds maximum ${g.baseWeightMax}. ` +
        `A single dimension should not dominate the score.`,
        value, g.baseWeightMax, "blocked"
      ));
    }
  }

  // ── Modifier weight bounds ─────────────────────────────────────────────────
  for (const [key, value] of Object.entries(modifierWeights)) {
    if (value < g.modifierWeightMin) {
      violations.push(violation(
        "scoring", "modifierWeightMin",
        `MODIFIER_WEIGHTS.${key} = ${value} is below minimum ${g.modifierWeightMin}. ` +
        `Modifier would have negligible effect.`,
        value, g.modifierWeightMin, "warned"
      ));
    }
    if (value > g.modifierWeightMax) {
      violations.push(violation(
        "scoring", "modifierWeightMax",
        `MODIFIER_WEIGHTS.${key} = ${value} exceeds maximum ${g.modifierWeightMax}. ` +
        `Modifier weight is too high and may destabilize scores.`,
        value, g.modifierWeightMax, "blocked"
      ));
    }
  }

  // ── Penalty cap bounds ─────────────────────────────────────────────────────
  if ((penaltyCaps.spike ?? 0) > g.maxSpikePenalty) {
    violations.push(violation(
      "scoring", "maxSpikePenalty",
      `PENALTY_CAPS.spike = ${penaltyCaps.spike} exceeds max ${g.maxSpikePenalty}.`,
      penaltyCaps.spike, g.maxSpikePenalty, "clamped"
    ));
  }
  if ((penaltyCaps.lowQuality ?? 0) > g.maxLowQualityPenalty) {
    violations.push(violation(
      "scoring", "maxLowQualityPenalty",
      `PENALTY_CAPS.lowQuality = ${penaltyCaps.lowQuality} exceeds max ${g.maxLowQualityPenalty}.`,
      penaltyCaps.lowQuality, g.maxLowQualityPenalty, "clamped"
    ));
  }

  const blocking = violations.filter(v => v.action === "blocked");

  return { ok: blocking.length === 0, violations, clamped: null };
}

/**
 * Assert that a computed score is within valid range.
 * Call this on each RankedTicker before it leaves prioritizeSignals().
 *
 * @param {string} ticker
 * @param {number} finalScore
 * @returns {GuardrailResult}
 */
export function assertScoreRange(ticker, finalScore) {
  const g          = GUARDRAILS.scoring;
  const violations = [];

  if (typeof finalScore !== "number" || isNaN(finalScore)) {
    violations.push(violation(
      "scoring", "scoreMustBeNumber",
      `${ticker} finalScore is ${finalScore} (not a number). Score floor applied.`,
      finalScore, "number", "clamped"
    ));
  } else {
    if (finalScore < g.scoreFloor) {
      violations.push(violation(
        "scoring", "scoreFloor",
        `${ticker} finalScore ${finalScore} is below floor ${g.scoreFloor}.`,
        finalScore, g.scoreFloor, "clamped"
      ));
    }
    if (finalScore > g.scoreCeiling) {
      violations.push(violation(
        "scoring", "scoreCeiling",
        `${ticker} finalScore ${finalScore} exceeds ceiling ${g.scoreCeiling}.`,
        finalScore, g.scoreCeiling, "clamped"
      ));
    }
  }

  const safeScore = Math.max(
    g.scoreFloor,
    Math.min(g.scoreCeiling, isNaN(finalScore) ? g.scoreFloor : finalScore)
  );

  return {
    ok:         violations.length === 0,
    violations,
    clamped:    { ticker, finalScore: safeScore },
  };
}

// ─── DOMAIN 3: Output guardrails ──────────────────────────────────────────────

/**
 * Assert that a ShortlistResult is within output guardrail bounds.
 *
 * Checks:
 *   - candidate count does not exceed maxCandidates
 *   - no duplicate tickers in candidates
 *   - all candidate adjustedScores are above minAdjustedScore
 *   - narrative / catalyst field lengths are within bounds
 *   - samplePosts count is within bounds
 *
 * Returns a clamped version of the candidates array safe to return to callers.
 *
 * @param {object}   input
 * @param {Array}    input.candidates
 * @param {Array}    input.excluded
 * @returns {GuardrailResult}
 */
export function assertOutput({ candidates = [], excluded = [] } = {}) {
  const g          = GUARDRAILS.output;
  const violations = [];

  // ── Candidate count ────────────────────────────────────────────────────────
  if (candidates.length > g.maxCandidates) {
    violations.push(violation(
      "output", "maxCandidates",
      `${candidates.length} candidates returned; max is ${g.maxCandidates}. Excess will be truncated.`,
      candidates.length, g.maxCandidates, "clamped"
    ));
  }

  // ── Duplicate tickers ──────────────────────────────────────────────────────
  const tickerCounts = {};
  for (const c of candidates) {
    tickerCounts[c.ticker] = (tickerCounts[c.ticker] ?? 0) + 1;
  }
  for (const [ticker, count] of Object.entries(tickerCounts)) {
    if (count > g.maxDuplicateTickers) {
      violations.push(violation(
        "output", "maxDuplicateTickers",
        `Ticker ${ticker} appears ${count} times in candidates. Should be exactly once.`,
        count, g.maxDuplicateTickers, "blocked"
      ));
    }
  }

  // ── Score floor ────────────────────────────────────────────────────────────
  for (const c of candidates) {
    if ((c.adjustedScore ?? 0) < g.minAdjustedScore) {
      violations.push(violation(
        "output", "minAdjustedScore",
        `${c.ticker} has adjustedScore ${c.adjustedScore} below output minimum ${g.minAdjustedScore}. ` +
        `Should have been excluded by shortlist stage.`,
        c.adjustedScore, g.minAdjustedScore, "warned"
      ));
    }
  }

  // ── Field length enforcement ───────────────────────────────────────────────
  for (const c of candidates) {
    if (c.narrativeSummary && c.narrativeSummary.length > g.maxNarrativeLength) {
      violations.push(violation(
        "output", "maxNarrativeLength",
        `${c.ticker} narrativeSummary is ${c.narrativeSummary.length} chars; max is ${g.maxNarrativeLength}. Will be truncated.`,
        c.narrativeSummary.length, g.maxNarrativeLength, "clamped"
      ));
    }
    if (c.keyCatalyst && c.keyCatalyst.length > g.maxCatalystLength) {
      violations.push(violation(
        "output", "maxCatalystLength",
        `${c.ticker} keyCatalyst is ${c.keyCatalyst.length} chars; max is ${g.maxCatalystLength}. Will be truncated.`,
        c.keyCatalyst.length, g.maxCatalystLength, "clamped"
      ));
    }
    if (c.keyRisk && c.keyRisk.length > g.maxCatalystLength) {
      violations.push(violation(
        "output", "maxCatalystLength",
        `${c.ticker} keyRisk is ${c.keyRisk.length} chars; max is ${g.maxCatalystLength}. Will be truncated.`,
        c.keyRisk.length, g.maxCatalystLength, "clamped"
      ));
    }
  }

  // ── samplePosts count ──────────────────────────────────────────────────────
  for (const c of candidates) {
    if ((c.samplePosts?.length ?? 0) > g.maxSamplePostsPerCandidate) {
      violations.push(violation(
        "output", "maxSamplePostsPerCandidate",
        `${c.ticker} has ${c.samplePosts.length} samplePosts; max is ${g.maxSamplePostsPerCandidate}. Excess will be trimmed.`,
        c.samplePosts.length, g.maxSamplePostsPerCandidate, "clamped"
      ));
    }
  }

  // ── Excluded list size ─────────────────────────────────────────────────────
  if (excluded.length > g.maxExcludedReturned) {
    violations.push(violation(
      "output", "maxExcludedReturned",
      `${excluded.length} excluded tickers; max returned is ${g.maxExcludedReturned}. Excess will be truncated.`,
      excluded.length, g.maxExcludedReturned, "clamped"
    ));
  }

  // ── Build clamped output ───────────────────────────────────────────────────
  const seenTickers = new Set();
  const clampedCandidates = candidates
    .slice(0, g.maxCandidates)
    .filter(c => {
      if (seenTickers.has(c.ticker)) return false;
      seenTickers.add(c.ticker);
      return true;
    })
    .map(c => ({
      ...c,
      narrativeSummary: c.narrativeSummary
        ? c.narrativeSummary.slice(0, g.maxNarrativeLength)
        : null,
      keyCatalyst: c.keyCatalyst
        ? c.keyCatalyst.slice(0, g.maxCatalystLength)
        : null,
      keyRisk: c.keyRisk
        ? c.keyRisk.slice(0, g.maxCatalystLength)
        : null,
      samplePosts: c.samplePosts
        ? c.samplePosts.slice(0, g.maxSamplePostsPerCandidate)
        : [],
    }));

  const clampedExcluded = excluded.slice(0, g.maxExcludedReturned);

  const blocking = violations.filter(v => v.action === "blocked");

  return {
    ok: blocking.length === 0,
    violations,
    clamped: {
      candidates: clampedCandidates,
      excluded:   clampedExcluded,
    },
  };
}

// ─── Composite assertion ──────────────────────────────────────────────────────

/**
 * Run all three domain assertions at once.
 * Returns a combined result.
 *
 * @param {object} input
 * @param {object} input.search   — { themes, plan, duplicates }
 * @param {object} input.scoring  — { baseWeights, modifierWeights, penaltyCaps }
 * @param {object} input.output   — { candidates, excluded }
 * @returns {{ ok: boolean, domains: { search, scoring, output } }}
 */
export function assertAll({ search = {}, scoring = {}, output = {} } = {}) {
  const searchResult  = assertSearch(search);
  const scoringResult = assertScoring(scoring);
  const outputResult  = assertOutput(output);

  const ok =
    searchResult.ok &&
    scoringResult.ok &&
    outputResult.ok;

  return {
    ok,
    domains: {
      search:  searchResult,
      scoring: scoringResult,
      output:  outputResult,
    },
  };
}

// ─── Violation reporter ───────────────────────────────────────────────────────

/**
 * Log violations to the console in a consistent format.
 * No-op if violations array is empty.
 *
 * @param {GuardrailViolation[]} violations
 * @param {string}               context     — e.g. "pipeline run run_123"
 */
export function reportViolations(violations, context = "guardrails") {
  if (!violations || violations.length === 0) return;

  const blocking = violations.filter(v => v.action === "blocked");
  const clamped  = violations.filter(v => v.action === "clamped");
  const warned   = violations.filter(v => v.action === "warned");

  console.warn(
    `[guardrails:${context}] ${violations.length} violation(s): ` +
    `${blocking.length} blocking, ${clamped.length} clamped, ${warned.length} warned`
  );

  for (const v of violations) {
    const prefix = v.action === "blocked" ? "✗" : v.action === "clamped" ? "≈" : "⚠";
    console.warn(`  ${prefix} [${v.domain}:${v.rule}] ${v.message}`);
  }
}

// ─── Failure mode catalogue ───────────────────────────────────────────────────
//
// Reference documentation — describes what each guardrail prevents.
// Not executed at runtime; used for audit and code review.

export const FAILURE_MODES = {

  // ── Search failure modes ───────────────────────────────────────────────────

  "search.maxThemesPerRun": {
    symptom:    "Pipeline attempts to search 20+ themes simultaneously.",
    cause:      "AI expander returns themes not in the original list; theme list grows unbounded across runs.",
    prevention: "Cap themes at 8 before query plan is built. Drop lowest-score themes.",
    detection:  "themes.length > GUARDRAILS.search.maxThemesPerRun",
  },

  "search.maxQueriesPerRun": {
    symptom:    "Reddit rate-limits the pipeline; runs take 5+ minutes; incomplete results.",
    cause:      "Per-theme query multiplication: 8 themes × 3 queries × 2 fallbacks = 48 queries.",
    prevention: "Hard-cap total queries at 10 in enforcePlanBudget().",
    detection:  "plan.length > GUARDRAILS.search.maxQueriesPerRun",
  },

  "search.maxQueriesPerTheme": {
    symptom:    "One popular theme (e.g. AI) consumes 8 of 10 query slots, starving other themes.",
    cause:      "AI expander generates 4 queries per theme; slot allocator doesn't enforce per-theme caps.",
    prevention: "Enforce per-theme cap inside enforcePlanBudget().",
    detection:  "perTheme[theme] > GUARDRAILS.search.maxQueriesPerTheme",
  },

  "search.maxDuplicateQueriesAllowed": {
    symptom:    "Deduplication logs 15+ identical queries across themes.",
    cause:      "AI expander uses the same financial jargon across themes ('earnings catalyst stocks').",
    prevention: "Warn when duplicates exceed 6; indicates expander needs prompt refinement.",
    detection:  "duplicates > GUARDRAILS.search.maxDuplicateQueriesAllowed",
  },

  "search.queryLength": {
    symptom:    "Reddit returns 0 results for queries like 'the current most important investment theme of 2025 Q2...'",
    cause:      "AI hallucination producing paragraph-length 'queries'.",
    prevention: "Truncate queries at 120 chars; reject queries under 8 chars.",
    detection:  "query.length > maxQueryLength || query.length < minQueryLength",
  },

  // ── Scoring failure modes ──────────────────────────────────────────────────

  "scoring.baseWeightSum": {
    symptom:    "Scores cluster at 50 or drift systematically high/low across all tickers.",
    cause:      "Developer adjusts one weight without adjusting others to rebalance.",
    prevention: "Assert sum ≈ 1.0 at module load. Fail loudly (blocking violation).",
    detection:  "Math.abs(sum - 1.0) > 0.001",
  },

  "scoring.baseWeightMax": {
    symptom:    "Mentions (or velocity) dominates every score; quality/consistency have no effect.",
    cause:      "Weight tuned to 0.70+ based on a good batch; locks in a single dimension.",
    prevention: "No single base weight above 0.65. Force balance.",
    detection:  "baseWeights[key] > GUARDRAILS.scoring.baseWeightMax",
  },

  "scoring.modifierWeightMax": {
    symptom:    "A single outlier concentration score swings the final score by 40 points.",
    cause:      "Modifier weight pushed above 0.30 during manual tuning.",
    prevention: "Cap each modifier at 0.30 (30% max swing per modifier).",
    detection:  "modifierWeights[key] > GUARDRAILS.scoring.modifierWeightMax",
  },

  "scoring.penaltyCap": {
    symptom:    "A legitimate thesis ticker receives a -60 penalty for one spike post.",
    cause:      "Spike penalty cap raised beyond 20 in an attempt to filter a specific bad actor.",
    prevention: "Clamp spike penalty at 20, lowQuality at 15, combined at 35.",
    detection:  "penalties.total < -GUARDRAILS.scoring.maxTotalPenalty",
  },

  "scoring.scoreFloor": {
    symptom:    "A ticker surfaces with finalScore = -8 and confuses downstream filtering.",
    cause:      "Multiple simultaneous penalties push the score below 0.",
    prevention: "Always clamp: Math.max(SCORE_FLOOR, finalScore).",
    detection:  "finalScore < GUARDRAILS.scoring.scoreFloor",
  },

  // ── Output failure modes ───────────────────────────────────────────────────

  "output.maxCandidates": {
    symptom:    "API response contains 25 candidates; frontend renders a wall of cards.",
    cause:      "Shortlist stage size-cap config drift (FILTER_CONFIG.maxCandidates changed).",
    prevention: "Clamp candidates to 10 in assertOutput before returning from runner.",
    detection:  "candidates.length > GUARDRAILS.output.maxCandidates",
  },

  "output.maxDuplicateTickers": {
    symptom:    "NVDA appears twice in the candidate list with different scores.",
    cause:      "Snapshot deduplication bug allows one post ID to create two ticker records.",
    prevention: "Deduplicate by ticker symbol in assertOutput (last line of defence).",
    detection:  "tickerCounts[ticker] > 1",
  },

  "output.maxNarrativeLength": {
    symptom:    "narrativeSummary is a 900-character paragraph that overflows the UI.",
    cause:      "Claude returns multi-sentence summaries when context is rich.",
    prevention: "Truncate at 400 chars before returning from analyzeSignals.",
    detection:  "narrativeSummary.length > GUARDRAILS.output.maxNarrativeLength",
  },

  "output.minAdjustedScore": {
    symptom:    "A ticker with adjustedScore 12 appears in the shortlist.",
    cause:      "Quality gate threshold in FILTER_CONFIG.minAdjustedScore was lowered.",
    prevention: "assertOutput warns when any candidate is below the output minimum.",
    detection:  "c.adjustedScore < GUARDRAILS.output.minAdjustedScore",
  },
};
