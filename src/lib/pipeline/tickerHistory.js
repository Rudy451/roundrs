// /lib/pipeline/tickerHistory.js
//
// Unified ticker history — assembles a complete TickerHistory object
// by querying across all four data sources:
//
//   snapshotStore    — raw mention counts, subreddit spread, mention timestamps
//   memoryStore      — pipeline run appearances with scores and signal types
//   evaluationStore  — outcome results (confirmed / noise / inconclusive)
//   searchLog        — which themes and queries surfaced this ticker
//
// Design:
//   - No separate storage. History is assembled on demand from existing stores.
//   - All fields are read-only views over append-only data. No aggregation loss.
//   - Oldest entry first in all timelines (natural for charting and analysis).

import { getSnapshots }              from "./snapshotStore.js";
import { getPipelineRuns }           from "./memoryStore.js";
import { getEvaluationsForTicker,
         getSignalsByTicker }        from "./evaluationStore.js";

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TickerHistory
 *
 * @property {string}   ticker
 * @property {number}   firstSeen        — unix ms of first pipeline appearance
 * @property {number}   lastSeen         — unix ms of most recent appearance
 * @property {number}   totalAppearances — number of pipeline runs where ticker appeared
 *
 * @property {SnapshotAppearance[]}  snapshots        — raw mention data per snapshot
 * @property {ScoreTimelineEntry[]}  scoreTimeline    — score over time (oldest first)
 * @property {AttentionTimelineEntry[]} attentionTimeline — mention counts over time
 * @property {ThemeAssociation[]}    themes           — theme associations over time
 * @property {EvaluationSummary[]}   evaluations      — outcome results
 *
 * @property {Analytics}             analytics        — derived statistics
 */

/**
 * @typedef {Object} SnapshotAppearance
 * @property {string}   snapshotId
 * @property {number}   timestamp      — unix ms
 * @property {number}   windowHours
 * @property {number}   mentions
 * @property {number}   avgUpvotes
 * @property {string[]} subreddits
 * @property {number[]} mentionTimes   — post createdUtc values (seconds)
 */

/**
 * @typedef {Object} ScoreTimelineEntry
 * @property {number}      timestamp
 * @property {string}      runId
 * @property {number}      score          — adjustedScore from shortlist
 * @property {string}      signalType
 * @property {string}      confidence
 */

/**
 * @typedef {Object} AttentionTimelineEntry
 * @property {number} timestamp
 * @property {string} snapshotId
 * @property {number} mentions
 * @property {string} velocity    — "high" | "medium" | "low"
 * @property {number} subredditCount
 */

/**
 * @typedef {Object} ThemeAssociation
 * @property {number} timestamp
 * @property {string} runId
 * @property {string} theme
 * @property {string} source   — "hot" | "theme" (how this ticker was surfaced)
 */

/**
 * @typedef {Object} EvaluationSummary
 * @property {string}  evalId
 * @property {string}  window
 * @property {number}  evaluatedAt
 * @property {string}  outcome        — "confirmed" | "noise" | "inconclusive"
 * @property {boolean} successFlag
 * @property {number}  outcomeScore
 * @property {string}  attentionTrend
 * @property {number}  initialScore
 */

/**
 * @typedef {Object} Analytics
 * @property {number|null}  avgScore
 * @property {number|null}  peakScore
 * @property {number|null}  latestScore
 * @property {number|null}  avgMentions
 * @property {number|null}  peakMentions
 * @property {string|null}  dominantSignalType
 * @property {string[]}     associatedThemes     — deduplicated
 * @property {number}       confirmationRate     — 0–100, from evaluations
 * @property {string|null}  momentumTrend        — "rising" | "steady" | "fading" | "unknown"
 * @property {number}       decayHalflife        — estimated hours until mentions halve (null if insufficient data)
 */

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build a complete TickerHistory for one ticker.
 * Assembles data from all sources on demand.
 *
 * @param {string} ticker
 * @param {object} options
 * @param {number} options.snapshotLimit — max snapshots to scan (default 96)
 * @param {number} options.runLimit      — max pipeline runs to scan (default 200)
 * @returns {TickerHistory | null}       — null if ticker never appeared
 */
export function buildTickerHistory(ticker, {
  snapshotLimit = 96,
  runLimit      = 200,
} = {}) {
  const upper = ticker.toUpperCase().trim();

  // ── Source 1: Snapshot appearances ──────────────────────────────────────────

  const allSnapshots   = getSnapshots({ limit: snapshotLimit });
  const snapshotAppearances = [];

  for (const snap of allSnapshots) {
    const record = snap.tickers?.find(t => t.ticker === upper);
    if (!record) continue;

    snapshotAppearances.push({
      snapshotId:   snap.snapshotId,
      timestamp:    snap.createdAt,
      windowHours:  snap.windowHours,
      mentions:     record.mentions,
      avgUpvotes:   record.avgUpvotes,
      subreddits:   record.subreddits ?? [],
      mentionTimes: record.mentionTimes ?? [],
    });
  }

  // ── Source 2: Pipeline run appearances (score timeline) ──────────────────────

  const allRuns    = getPipelineRuns(runLimit);
  const scoreTimeline = [];

  for (const run of allRuns) {
    const candidate = run.candidateSummaries?.find(c => c.ticker === upper);
    if (!candidate) continue;

    scoreTimeline.push({
      timestamp:  run.timestamp,
      runId:      run.runId,
      score:      candidate.score,
      signalType: candidate.signalType,
      confidence: candidate.confidence,
    });
  }

  // Return null if never appeared in either source
  if (snapshotAppearances.length === 0 && scoreTimeline.length === 0) {
    return null;
  }

  // Sort oldest first for timelines
  snapshotAppearances.sort((a, b) => a.timestamp - b.timestamp);
  scoreTimeline.sort((a, b) => a.timestamp - b.timestamp);

  // ── Source 3: Attention timeline (from snapshots) ────────────────────────────

  const attentionTimeline = snapshotAppearances.map(s => ({
    timestamp:      s.timestamp,
    snapshotId:     s.snapshotId,
    mentions:       s.mentions,
    velocity:       classifyVelocity(s.mentions, s.mentionTimes, s.windowHours),
    subredditCount: s.subreddits.length,
  }));

  // ── Source 4: Theme associations (from run candidateSummaries + signal records) ─

  const themeAssociations = [];
  const signalRecords     = getSignalsByTicker(upper, 100);

  for (const record of signalRecords) {
    // Themes come from samplePosts on the signal record if available
    // Fall back to the run's theme list
    const run      = allRuns.find(r => r.runId === record.snapshotId);
    const themes   = run?.themes ?? [];
    const sourceTs = record.surfacedAt;

    for (const theme of themes) {
      themeAssociations.push({
        timestamp: sourceTs,
        runId:     record.snapshotId,
        theme,
        source:    "theme",
      });
    }
  }

  // Also extract themes from snapshot enriched data
  for (const snap of allSnapshots) {
    const inShortlist = snap.tickersShortlisted?.find(c => c.ticker === upper);
    if (!inShortlist) continue;

    for (const theme of (snap.themes ?? [])) {
      // Avoid duplicates with signal record themes
      const exists = themeAssociations.some(
        t => t.snapshotId === snap.snapshotId && t.theme === theme
      );
      if (!exists) {
        themeAssociations.push({
          timestamp: snap.createdAt,
          snapshotId: snap.snapshotId,
          theme,
          source:    "snapshot",
        });
      }
    }
  }

  themeAssociations.sort((a, b) => a.timestamp - b.timestamp);

  // ── Source 5: Evaluation outcomes ────────────────────────────────────────────

  const rawEvals     = getEvaluationsForTicker(upper, 50);
  const evaluations  = rawEvals.map(e => ({
    evalId:         e.evalId,
    window:         e.window,
    evaluatedAt:    e.evaluatedAt,
    outcome:        e.outcome,
    successFlag:    e.successFlag,
    outcomeScore:   e.outcomeScore,
    attentionTrend: e.attentionTrend,
    initialScore:   e.initialScore,
  })).sort((a, b) => a.evaluatedAt - b.evaluatedAt);

  // ── Analytics ─────────────────────────────────────────────────────────────────

  const analytics = computeAnalytics(scoreTimeline, attentionTimeline, themeAssociations, evaluations);

  // ── Assemble ─────────────────────────────────────────────────────────────────

  const allTimestamps = [
    ...snapshotAppearances.map(s => s.timestamp),
    ...scoreTimeline.map(s => s.timestamp),
  ];

  return {
    ticker:           upper,
    firstSeen:        allTimestamps.length > 0 ? Math.min(...allTimestamps) : null,
    lastSeen:         allTimestamps.length > 0 ? Math.max(...allTimestamps) : null,
    totalAppearances: Math.max(snapshotAppearances.length, scoreTimeline.length),
    snapshots:        snapshotAppearances,
    scoreTimeline,
    attentionTimeline,
    themes:           themeAssociations,
    evaluations,
    analytics,
  };
}

// ─── Analytics computation ────────────────────────────────────────────────────

function computeAnalytics(scoreTimeline, attentionTimeline, themes, evaluations) {
  // Score stats
  const scores      = scoreTimeline.map(e => e.score).filter(s => s != null);
  const avgScore    = scores.length ? round1(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
  const peakScore   = scores.length ? Math.max(...scores) : null;
  const latestScore = scores.length ? scores[scores.length - 1] : null;

  // Mention stats
  const mentions     = attentionTimeline.map(e => e.mentions).filter(m => m != null);
  const avgMentions  = mentions.length ? round1(mentions.reduce((s, v) => s + v, 0) / mentions.length) : null;
  const peakMentions = mentions.length ? Math.max(...mentions) : null;

  // Dominant signal type
  const typeCounts = {};
  for (const e of scoreTimeline) {
    const t = e.signalType ?? "unknown";
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }
  const dominantSignalType = Object.keys(typeCounts).length > 0
    ? Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // Associated themes (deduplicated, most frequent first)
  const themeCounts = {};
  for (const t of themes) {
    themeCounts[t.theme] = (themeCounts[t.theme] ?? 0) + 1;
  }
  const associatedThemes = Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([theme]) => theme);

  // Confirmation rate from evaluations
  const decided     = evaluations.filter(e => e.outcome !== "inconclusive");
  const confirmed   = evaluations.filter(e => e.outcome === "confirmed").length;
  const confirmationRate = decided.length > 0
    ? Math.round((confirmed / decided.length) * 100)
    : 0;

  // Momentum trend — compare last 3 scores to previous 3
  const momentumTrend = computeMomentumTrend(scores);

  // Signal decay halflife estimate
  const decayHalflife = estimateDecayHalflife(attentionTimeline);

  return {
    avgScore,
    peakScore,
    latestScore,
    avgMentions,
    peakMentions,
    dominantSignalType,
    associatedThemes,
    confirmationRate,
    momentumTrend,
    decayHalflife,
  };
}

// ─── Momentum trend ───────────────────────────────────────────────────────────
//
// Compare the mean of the last 3 scores to the mean of the 3 before that.
// Requires at least 4 data points to classify.

function computeMomentumTrend(scores) {
  if (scores.length < 4) return "unknown";

  const recent = scores.slice(-3);
  const prior  = scores.slice(-6, -3);

  if (prior.length === 0) return "unknown";

  const recentMean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const priorMean  = prior.reduce((s, v) => s + v, 0) / prior.length;

  const ratio = recentMean / (priorMean || 1);

  if (ratio >= 1.15) return "rising";
  if (ratio >= 0.88) return "steady";
  return "fading";
}

// ─── Decay halflife ───────────────────────────────────────────────────────────
//
// Fits a simple exponential decay model to the mention counts over time.
// Returns estimated hours until mentions halve (null if insufficient data).
// Uses least-squares fit on log(mentions) vs elapsed hours.

function estimateDecayHalflife(attentionTimeline) {
  if (attentionTimeline.length < 4) return null;

  const entries = attentionTimeline.filter(e => e.mentions > 0);
  if (entries.length < 3) return null;

  const t0  = entries[0].timestamp;
  const xs  = entries.map(e => (e.timestamp - t0) / 3600000); // hours
  const ys  = entries.map(e => Math.log(e.mentions));

  // Simple linear regression on (x, log(y)) = log(A) + k*x
  const n   = xs.length;
  const sx  = xs.reduce((s, v) => s + v, 0);
  const sy  = ys.reduce((s, v) => s + v, 0);
  const sxy = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);

  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-10) return null;

  const k = (n * sxy - sx * sy) / denom;

  // k is the decay rate (negative = decaying)
  if (k >= 0) return null; // growing, not decaying

  // Halflife = ln(2) / |k|  (in hours)
  const halflife = Math.round(Math.LN2 / Math.abs(k));
  return halflife > 0 && halflife < 10000 ? halflife : null;
}

// ─── Velocity from raw mention times ─────────────────────────────────────────

function classifyVelocity(mentions, mentionTimes, windowHours) {
  if (!mentionTimes || mentionTimes.length === 0) return "low";
  const nowS   = Math.floor(Date.now() / 1000);
  const halfW  = (windowHours * 3600) / 2;
  const recent = mentionTimes.filter(t => t >= nowS - halfW).length;
  const ratio  = mentions > 0 ? recent / mentions : 0;
  if (ratio >= 0.6) return "high";
  if (ratio >= 0.3) return "medium";
  return "low";
}

function round1(n) { return Math.round(n * 10) / 10; }

// ─── Batch helpers ────────────────────────────────────────────────────────────

/**
 * Build histories for multiple tickers.
 * Returns only tickers that have at least one appearance.
 *
 * @param {string[]} tickers
 * @returns {TickerHistory[]}
 */
export function buildTickerHistories(tickers) {
  return tickers
    .map(t => buildTickerHistory(t))
    .filter(Boolean);
}

/**
 * Get a compact summary suitable for a history dashboard.
 * Cheaper than building a full history.
 *
 * @param {string} ticker
 * @returns {object | null}
 */
export function getTickerSummary(ticker) {
  const history = buildTickerHistory(ticker, { snapshotLimit: 48, runLimit: 100 });
  if (!history) return null;

  return {
    ticker:           history.ticker,
    firstSeen:        history.firstSeen,
    lastSeen:         history.lastSeen,
    totalAppearances: history.totalAppearances,
    analytics:        history.analytics,
    latestSignalType: history.scoreTimeline.at(-1)?.signalType ?? null,
    latestConfidence: history.scoreTimeline.at(-1)?.confidence ?? null,
    evaluationCount:  history.evaluations.length,
  };
}
