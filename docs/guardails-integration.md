// GUARDRAILS INTEGRATION GUIDE
// ─────────────────────────────────────────────────────────────────────────────
// File: /docs/guardrails-integration.md  (or keep as a JS comment block)
//
// This file shows exactly where each guardrail assertion plugs into the
// existing pipeline. No pipeline logic is changed — assertions are additive
// call sites only.
//
// Three integration points:
//   1. Module load    — assertScoring() fires once when prioritize.js loads
//   2. Stage entry    — assertSearch() fires before queries hit Reddit
//   3. Stage exit     — assertOutput() fires before PipelineResult is written
//
// Pattern at every call site:
//
//   const check = assert*(input);
//   reportViolations(check.violations, context);
//   if (!check.ok) { /* abort or use check.clamped */ }
//   const safe = check.clamped ?? input;
//
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. prioritize.js — module load ───────────────────────────────────────────
//
// File: src/lib/pipeline/prioritize.js
// When: Once, at module initialization (before any run)
// Why:  Catches weight misconfiguration before a single ticker is scored.
//
// Add at the bottom of the config block, after BASE_WEIGHTS is defined:

/*
import { assertScoring, reportViolations } from "./guardrails.js";

// Validate scoring config at load time.
// A blocking violation here means scores cannot be trusted —
// the pipeline will still run but violations are logged loudly.
const _scoringCheck = assertScoring({
  baseWeights:     BASE_WEIGHTS,
  modifierWeights: MODIFIER_WEIGHTS,
  penaltyCaps:     PENALTY_CAPS,
});
reportViolations(_scoringCheck.violations, "prioritize:module-load");
if (!_scoringCheck.ok) {
  console.error(
    "[guardrails] Scoring config has blocking violations. " +
    "Scores may be incorrect. Review BASE_WEIGHTS in prioritize.js."
  );
}
*/

// ── 2. prioritize.js — per-ticker score clamp ─────────────────────────────────
//
// File: src/lib/pipeline/prioritize.js
// When: Inside prioritizeSignals(), after finalScore is computed for each ticker
// Why:  Last-resort floor/ceiling enforcement before the score is written
//       to the RankedTicker record.
//
// Replace the existing:
//   finalScore = Math.max(SCORE_FLOOR, rawScore);
//
// With:

/*
import { assertScoreRange, reportViolations } from "./guardrails.js";

// After computing rawScore:
const rangeCheck = assertScoreRange(ticker, rawScore);
if (rangeCheck.violations.length > 0) {
  reportViolations(rangeCheck.violations, `prioritize:${ticker}`);
}
const finalScore = rangeCheck.clamped.finalScore;
*/

// ── 3. ingest.js / themeWorkbench.js — before queries execute ─────────────────
//
// File: src/lib/pipeline/ingest.js  (or wherever buildQueryPlan() is called)
// When: After the query plan is assembled, before any Reddit fetch
// Why:  Prevents query explosion and theme drift from ever reaching the API.
//
// Add after buildQueryPlan() returns:

/*
import { assertSearch, reportViolations } from "./guardrails.js";

const searchCheck = assertSearch({
  themes,           // string[] of active theme names for this run
  plan,             // Array<{ theme, query, source }> from buildQueryPlan()
  duplicates,       // number returned by deduplicateQueries()
});

reportViolations(searchCheck.violations, `ingest:run_${runId}`);

// Use the clamped plan regardless — it is always safe to execute.
// If there were blocking violations (bad query strings), they are
// excluded from clamped.plan automatically.
const safePlan = searchCheck.clamped.plan;
const safeThemes = searchCheck.clamped.themes;

// Proceed with safePlan instead of plan.
*/

// ── 4. runner.js — before writing PipelineResult ──────────────────────────────
//
// File: src/lib/pipeline/runner.js
// When: After shortlist stage returns candidates + excluded,
//       before the PipelineResult snapshot is constructed.
// Why:  Final gate. Catches any candidate that slipped through shortlist
//       filters, enforces top-N, deduplicates tickers, truncates field lengths.
//
// Add before buildSnapshot() / the return statement in runDiscoveryPipeline():

/*
import { assertOutput, reportViolations } from "./guardrails.js";

const outputCheck = assertOutput({
  candidates: shortlistResult.candidates,
  excluded:   shortlistResult.excluded,
});

reportViolations(outputCheck.violations, `runner:run_${runId}`);

// Always use clamped output — it is safe even when ok === true.
const { candidates, excluded } = outputCheck.clamped;

// Now build PipelineResult with clamped candidates.
*/

// ── 5. analyzeSignals.js — after Claude response is parsed ────────────────────
//
// File: src/lib/pipeline/analyzeSignals.js  (AI analysis stage)
// When: After parsing Claude's JSON response for each candidate
// Why:  Claude sometimes returns oversized narrative fields.
//       Truncation here keeps the output schema stable before
//       fields are merged into the candidate record.
//
// Add after parsing the Claude response object:

/*
import { GUARDRAILS } from "./guardrails.js";
const G = GUARDRAILS.output;

// Clamp AI-generated text fields inline.
const safeAnalysis = {
  ...claudeResponse,
  narrativeSummary: claudeResponse.narrativeSummary
    ? claudeResponse.narrativeSummary.slice(0, G.maxNarrativeLength)
    : null,
  keyCatalyst: claudeResponse.keyCatalyst
    ? claudeResponse.keyCatalyst.slice(0, G.maxCatalystLength)
    : null,
  keyRisk: claudeResponse.keyRisk
    ? claudeResponse.keyRisk.slice(0, G.maxCatalystLength)
    : null,
};
*/

// ─────────────────────────────────────────────────────────────────────────────
// ENFORCEMENT POINT SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
//
// Point                  File                    Domain    When
// ─────────────────────────────────────────────────────────────────────────────
// 1. Module load         prioritize.js           scoring   Once, at import
// 2. Per-ticker clamp    prioritize.js           scoring   Each ticker scored
// 3. Query plan          ingest.js               search    Before Reddit fetch
// 4. Pipeline exit       runner.js               output    Before snapshot write
// 5. AI field clamp      analyzeSignals.js       output    After Claude parse
// ─────────────────────────────────────────────────────────────────────────────
//
// VIOLATION ACTION LEGEND
// ─────────────────────────────────────────────────────────────────────────────
// blocked  — input rejected; pipeline uses clamped fallback or skips the item
// clamped  — input accepted but modified to fit within bounds
// warned   — input accepted as-is; logged for operator review
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT GUARDRAILS DO NOT DO
// ─────────────────────────────────────────────────────────────────────────────
// - They do not change the pipeline's logic or design
// - They do not alter scoring formula outcomes (only clamp final results)
// - They do not reject valid configurations that fall within bounds
// - They do not add latency to the hot path (all checks are synchronous O(n))
// - They do not replace the shortlist filter rules (H1–H4, S1–S5, G1, CAP);
//   assertOutput() is a final safety net, not a replacement for those rules
// ─────────────────────────────────────────────────────────────────────────────
