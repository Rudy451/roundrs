// /lib/pipeline/runner.js
//
// Single entry point for the DraftBoard discovery pipeline.
//
// PUBLIC API — one function, one name:
//   runDiscoveryPipeline(options) → PipelineResult
//
// Stage order (deterministic, no side effects between stages):
//   1. Ingest     — fetch Reddit posts (hot feed + theme search)
//   2. Normalize  — quality filter, crosspost dedup, text cleaning
//   3. Extract    — identify tickers per post
//   4. Snapshot   — build atomic, time-windowed, immutable snapshot
//   5. Aggregate  — count mentions, classify velocity
//   6. Prioritize — deterministic weighted scoring (mentions/velocity/theme)
//
// The output (PipelineResult) is the contract between this module and all callers.
// All callers — API routes, scheduler, cron — read only from PipelineResult fields.
// No caller reads internal stage data directly.

import { fetchRedditBatch }                    from "./ingest.js";
import { normalizePosts }                      from "./normalize.js";
import { extractFromPosts, KNOWN_TICKERS }     from "./extract.js";
import { buildSnapshot, validateSnapshot }     from "./snapshot.js";
import { saveSnapshot }                        from "./snapshotStore.js";
import { aggregateTickers }                    from "./aggregate.js";
import { prioritizeSignals,
         summarizePrioritization }             from "./prioritize.js";
import { getEdgeStats, clearEdgeLog }          from "./edgeLog.js";
import { getMockBatch }                        from "./mockData.js";

// ─── PipelineResult schema ────────────────────────────────────────────────────
//
// This is the contract. Every field listed here is guaranteed to exist.
// No caller should access result.meta.stages.* directly — use result.summary.
//
// @typedef {Object} PipelineResult
// @property {boolean}        success       — true if pipeline completed without fatal error
// @property {string|null}    error         — error message if success === false
// @property {RankedTicker[]} signals       — scored, sorted ticker candidates (may be empty)
// @property {Snapshot|null}  snapshot      — atomic snapshot for this run (null on error)
// @property {RunSummary}     summary       — human-readable stats for logging/display
// @property {object}         meta          — internal stage timings (not for display)
//
// @typedef {Object} RunSummary
// @property {string}      runId
// @property {number}      timestamp
// @property {number}      durationMs
// @property {number}      postsIngested
// @property {number}      postsFiltered
// @property {number}      uniqueTickers
// @property {number}      candidates
// @property {string|null} topTicker
// @property {number|null} topScore
// @property {string|null} snapshotId
// @property {object}      edgeCases

// ─── Options ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  topN:            20,
  validateTickers: true,
  dryRun:          false,
  themes:          ["AI", "oil", "interest rates", "crypto"],
  windowHours:     6,
  themeScores:     {},
};

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Run the full DraftBoard discovery pipeline.
 *
 * This is the single entry point. All callers use this function.
 * No other function in this module is exported.
 *
 * @param {object}   options
 * @param {number}   options.topN            — max tickers in output (default 20)
 * @param {boolean}  options.validateTickers — validate against known ticker list (default true)
 * @param {boolean}  options.dryRun          — use mock data, no network calls (default false)
 * @param {string[]} options.themes          — investment themes for targeted search
 * @param {number}   options.windowHours     — snapshot time window in hours (default 6)
 * @param {object}   options.themeScores     — { theme: 0–100 } from themeScorer (optional)
 * @returns {Promise<PipelineResult>}
 */
export async function runDiscoveryPipeline(options = {}) {
  const cfg       = { ...DEFAULTS, ...options };
  const runId     = `run_${Date.now()}`;
  const startTime = Date.now();
  const stages    = {};

  clearEdgeLog();

  console.log(`[pipeline] Starting run ${runId} — dryRun=${cfg.dryRun} themes=${cfg.themes.join(",")}`);

  try {

    // ── Stage 1: Ingest ──────────────────────────────────────────────────────

    let posts, ingestMeta, themedBatches;

    if (cfg.dryRun) {
      ({ posts, themedBatches, meta: ingestMeta } = getMockBatch());
      console.log(`[pipeline:ingest] dry run — ${posts.length} mock posts`);
    } else {
      ({ posts, themedBatches, meta: ingestMeta } = await fetchRedditBatch({
        themes:     cfg.themes,
        skipThemes: cfg.themes.length === 0,
      }));
      console.log(`[pipeline:ingest] ${posts.length} posts — ${ingestMeta.durationMs}ms`);
    }

    stages.ingest = {
      postCount:    posts.length,
      hotPosts:     ingestMeta.hotPosts    ?? posts.length,
      themePosts:   ingestMeta.themePosts  ?? 0,
      dedupedOut:   ingestMeta.dedupedOut  ?? 0,
      durationMs:   ingestMeta.durationMs,
      perSubreddit: ingestMeta.perSubreddit,
    };

    if (posts.length === 0) {
      console.warn("[pipeline:ingest] No posts fetched — aborting run");
      return failResult(runId, startTime, stages, "No posts fetched — Reddit may be rate-limiting. Try dryRun:true.");
    }

    // ── Stage 2: Normalize ───────────────────────────────────────────────────

    const normalized = normalizePosts(posts);

    stages.normalize = {
      input:    posts.length,
      output:   normalized.length,
      filtered: posts.length - normalized.length,
    };

    console.log(`[pipeline:normalize] ${normalized.length}/${posts.length} posts passed quality filter`);

    if (normalized.length === 0) {
      return failResult(runId, startTime, stages, "All posts filtered — check quality thresholds");
    }

    // ── Stage 3: Extract ─────────────────────────────────────────────────────

    const knownSet  = cfg.validateTickers ? KNOWN_TICKERS : null;
    const extracted = extractFromPosts(normalized, knownSet);

    const totalMentions = extracted.reduce((s, e) => s + e.tickers.length, 0);
    const uniqueTickers = new Set(extracted.flatMap(e => e.tickers));

    stages.extract = {
      totalMentions,
      uniqueTickers: uniqueTickers.size,
      validating:    cfg.validateTickers,
    };

    console.log(`[pipeline:extract] ${uniqueTickers.size} unique tickers, ${totalMentions} total mentions`);

    // ── Stage 4: Snapshot ────────────────────────────────────────────────────

    const snapshot   = buildSnapshot({ posts, extracted, windowHours: cfg.windowHours, ingestMeta });
    const violations = validateSnapshot(snapshot);

    if (violations.length > 0) {
      console.warn(`[pipeline:snapshot] ${violations.length} validation warnings:`, violations);
    }

    saveSnapshot(snapshot);

    stages.snapshot = {
      snapshotId:  snapshot.snapshotId,
      windowHours: snapshot.windowHours,
      postCount:   snapshot.postCount,
      tickerCount: snapshot.tickerCount,
      violations:  violations.length,
    };

    console.log(`[pipeline:snapshot] ${snapshot.snapshotId} — ${snapshot.tickerCount} tickers in ${snapshot.windowHours}h window`);

    // ── Stage 5: Aggregate ───────────────────────────────────────────────────

    const aggregated = aggregateTickers(extracted, { topN: cfg.topN });

    stages.aggregate = {
      candidates: aggregated.length,
      topTicker:  aggregated[0]?.ticker ?? null,
    };

    console.log(`[pipeline:aggregate] ${aggregated.length} candidates — top: ${aggregated[0]?.ticker ?? "none"}`);

    // ── Stage 6: Prioritize ──────────────────────────────────────────────────

    const signals   = prioritizeSignals(aggregated, cfg.themeScores);
    const priSummary = summarizePrioritization(signals);

    stages.prioritize = priSummary;

    console.log(`[pipeline:prioritize] top: ${signals[0]?.ticker ?? "none"} (${signals[0]?.totalScore ?? 0})`);

    // ── Assemble result ──────────────────────────────────────────────────────

    const summary = {
      runId,
      timestamp:     Date.now(),
      durationMs:    Date.now() - startTime,
      postsIngested: posts.length,
      postsFiltered: posts.length - normalized.length,
      uniqueTickers: uniqueTickers.size,
      candidates:    signals.length,
      topTicker:     signals[0]?.ticker    ?? null,
      topScore:      signals[0]?.totalScore ?? null,
      snapshotId:    snapshot.snapshotId,
      edgeCases:     getEdgeStats(),
    };

    console.log(`[pipeline] Run ${runId} complete — ${signals.length} signals, top: ${summary.topTicker} (${summary.topScore}) in ${summary.durationMs}ms`);

    return {
      success:  true,
      error:    null,
      signals,
      snapshot,
      summary,
      meta: { stages },
    };

  } catch (err) {
    console.error(`[pipeline] Run ${runId} failed:`, err);
    return failResult(runId, startTime, stages, err.message);
  }
}

// ─── Fail result factory ──────────────────────────────────────────────────────

function failResult(runId, startTime, stages, errorMessage) {
  return {
    success:  false,
    error:    errorMessage,
    signals:  [],
    snapshot: null,
    summary: {
      runId,
      timestamp:     Date.now(),
      durationMs:    Date.now() - startTime,
      postsIngested: stages.ingest?.postCount ?? 0,
      postsFiltered: 0,
      uniqueTickers: 0,
      candidates:    0,
      topTicker:     null,
      topScore:      null,
      snapshotId:    null,
      edgeCases:     getEdgeStats(),
    },
    meta: { stages },
  };
}

// ─── Backward compatibility alias ─────────────────────────────────────────────
// Any existing import of runPipeline() continues to work unchanged.

export const runPipeline = runDiscoveryPipeline;
