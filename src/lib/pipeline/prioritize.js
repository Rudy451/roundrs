// /lib/pipeline/prioritize.js
//
// Stage 5: Deterministic signal prioritization.
//
// Converts TickerSignal[] from the aggregation stage into RankedTicker[]
// using a weighted, normalized scoring model.
//
// Rules:
//   - Deterministic only. No AI, no randomness, no external calls.
//   - Same input always produces same output.
//   - Scores are normalized to [0, 100] before weighting so no single
//     metric dominates due to scale differences.
//   - Output feeds directly into the Claude ranking stage, which uses
//     these scores as context rather than starting from raw counts.

import { getSnapshots }   from "./snapshotStore.js";

// ─── Scoring weights ──────────────────────────────────────────────────────────
//
// Three metrics, three weights, must sum to 1.0.
// Adjust here — nowhere else.

export const WEIGHTS = {
  mentions:  0.40,  // volume signal — how many posts mention this ticker
  velocity:  0.35,  // momentum signal — rate of change vs. prior window
  theme:     0.25,  // context signal — strength of theme alignment
};

// Validate at module load — catches accidental weight drift during development
const weightSum = Object.values(WEIGHTS).reduce((s, v) => s + v, 0);
if (Math.abs(weightSum - 1.0) > 0.001) {
  throw new Error(`[prioritize] Weights must sum to 1.0, got ${weightSum}`);
}

// ─── Metric: Mentions score ───────────────────────────────────────────────────
//
// Normalized mention count: (ticker_mentions / max_mentions_in_batch) × 100
//
// Why normalize against the batch max rather than a fixed ceiling?
// The absolute number of mentions varies by window size and subreddit activity.
// A ticker with 5 mentions in a quiet window deserves the same relative score
// as a ticker with 15 mentions in a busy window — both led their batch.

/**
 * @param {number} mentions      — this ticker's mention count
 * @param {number} maxMentions   — highest mention count in the current batch
 * @returns {number} 0–100
 */
function mentionsScore(mentions, maxMentions) {
  if (maxMentions === 0) return 0;
  return (mentions / maxMentions) * 100;
}

// ─── Metric: Velocity score ───────────────────────────────────────────────────
//
// Continuous velocity: how much faster is this ticker gaining mentions
// compared to its own history?
//
// Strategy (in priority order):
//   1. If two snapshots exist: ratio of current mentions to previous mentions
//   2. If one snapshot exists: compare to the mention count in that snapshot
//   3. No history: use intra-window recency clustering
//
// Output is clamped to [0, 100]:
//   100 = new ticker or mentions tripled
//   50  = flat (same as previous window)
//   0   = mentions halved or more

/**
 * @param {TickerSignal} signal   — current aggregation output for this ticker
 * @param {Snapshot[]}   history  — recent snapshots, newest first
 * @returns {number} 0–100
 */
function velocityScore(signal, history) {
  const current = signal.mentions;

  // Strategy 1 & 2: compare against snapshot history
  if (history.length >= 1) {
    const prevSnapshot = history[0];
    const prevRecord   = prevSnapshot.tickers.find(t => t.ticker === signal.ticker);
    const prev         = prevRecord?.mentions ?? 0;

    if (prev === 0) {
      // New ticker — first appearance in history
      // Score based on how many mentions it arrived with
      return Math.min(100, 50 + current * 10);
    }

    const ratio = current / prev;

    // Map ratio to [0, 100]:
    //   ratio ≥ 3.0 → 100 (tripled or more)
    //   ratio = 1.0 → 50  (flat)
    //   ratio ≤ 0.5 → 0   (halved or more)
    //
    // Linear between anchor points:
    if (ratio >= 3.0) return 100;
    if (ratio >= 1.0) return 50 + ((ratio - 1.0) / 2.0) * 50; // 1.0→50, 3.0→100
    if (ratio >= 0.5) return (ratio - 0.5) / 0.5 * 50;         // 0.5→0, 1.0→50
    return 0;
  }

  // Strategy 3: recency clustering within current window
  // Uses mentionTimes from the signal (array of createdUtc seconds)
  const times = signal.mentionTimes ?? [];
  if (times.length === 0) return 25; // conservative default

  const nowS         = Math.floor(Date.now() / 1000);
  const twoHoursAgo  = nowS - 2 * 3600;
  const sixHoursAgo  = nowS - 6 * 3600;

  const last2h = times.filter(t => t >= twoHoursAgo).length;
  const last6h = times.filter(t => t >= sixHoursAgo).length;

  if (last6h === 0) return 25;

  // Recency ratio: what fraction of window mentions happened in the last 2 hours?
  const recencyRatio = last2h / last6h;

  // 0.0 = all mentions are old → 25 (below neutral)
  // 0.33 = evenly spread → 50 (neutral)
  // 1.0 = all mentions recent → 100
  return Math.round(25 + recencyRatio * 75);
}

// ─── Metric: Theme relevance score ───────────────────────────────────────────
//
// How strongly is this ticker aligned with active, high-scoring themes?
//
// Two inputs:
//   a. Direct theme tag: was this ticker surfaced by a theme search query?
//      If yes, what was that theme's score?
//   b. Subreddit spread: mentions across multiple subreddits suggest organic
//      attention rather than a single-source spike.
//
// Both inputs are normalized to [0, 100] and averaged.

/**
 * @param {TickerSignal} signal       — has samplePosts with .theme and .subreddit
 * @param {object}       themeScores  — { [theme: string]: number (0–100) }
 * @returns {number} 0–100
 */
function themeScore(signal, themeScores) {
  // a. Theme alignment: find the highest-scoring theme this ticker appeared in
  const themes = [
    ...new Set(
      (signal.samplePosts ?? [])
        .map(p => p.theme)
        .filter(Boolean)
    ),
  ];

  let themeAlignment = 0;
  if (themes.length > 0 && Object.keys(themeScores).length > 0) {
    const scores = themes.map(t => themeScores[t] ?? 0);
    themeAlignment = Math.max(...scores); // take the strongest theme association
  } else if (themes.length > 0) {
    // Theme exists but no score available — give moderate credit
    themeAlignment = 50;
  }
  // If no theme, themeAlignment stays 0 — ticker came from hot feed only

  // b. Subreddit spread: 1 sub = 0, 2 subs = 50, 3+ subs = 100
  const subCount = signal.subreddits?.length ?? 1;
  const spread   = Math.min(100, (subCount - 1) * 50);

  // Average the two components
  return Math.round((themeAlignment + spread) / 2);
}

// ─── Total score ──────────────────────────────────────────────────────────────

/**
 * Compute the weighted total score from the three normalized components.
 *
 * @param {number} mScore — mentions score (0–100)
 * @param {number} vScore — velocity score (0–100)
 * @param {number} tScore — theme score (0–100)
 * @returns {number} 0–100, rounded to 1 decimal
 */
function totalScore(mScore, vScore, tScore) {
  const raw =
    mScore * WEIGHTS.mentions +
    vScore * WEIGHTS.velocity +
    tScore * WEIGHTS.theme;
  return Math.round(raw * 10) / 10; // 1 decimal place
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Score and rank a batch of TickerSignals.
 *
 * @param {TickerSignal[]} signals     — from aggregateTickers()
 * @param {object}         themeScores — { theme: score } from themeScorer, may be empty
 * @returns {RankedTicker[]}           — sorted by totalScore DESC, then ticker ASC
 */
export function prioritizeSignals(signals, themeScores = {}) {
  if (!signals || signals.length === 0) return [];

  // Load recent snapshots for velocity calculation (newest first, skip current)
  const history = getSnapshots({ limit: 3 });

  // Compute batch max for mentions normalization
  const maxMentions = Math.max(...signals.map(s => s.mentions), 1);

  // Score each ticker
  const scored = signals.map(signal => {
    const mScore = mentionsScore(signal.mentions, maxMentions);
    const vScore = velocityScore(signal, history);
    const tScore = themeScore(signal, themeScores);
    const total  = totalScore(mScore, vScore, tScore);

    return {
      ticker:          signal.ticker,
      mentionsScore:   Math.round(mScore * 10) / 10,
      velocityScore:   Math.round(vScore * 10) / 10,
      themeScore:      Math.round(tScore * 10) / 10,
      totalScore:      total,
      // Pass-through fields used by the Claude ranking stage
      mentions:        signal.mentions,
      velocity:        signal.velocity,   // categorical label for display
      avgUpvotes:      signal.avgUpvotes,
      lastSeen:        signal.lastSeen,
      samplePosts:     signal.samplePosts,
    };
  });

  // Sort: totalScore DESC, then ticker ASC for deterministic tie-breaking
  return scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.ticker.localeCompare(b.ticker);
  });
}

/**
 * Summarize the scoring results for a run log entry.
 * @param {RankedTicker[]} ranked
 * @returns {object}
 */
export function summarizePrioritization(ranked) {
  if (ranked.length === 0) return { count: 0 };

  const scores = ranked.map(r => r.totalScore);
  return {
    count:        ranked.length,
    topTicker:    ranked[0].ticker,
    topScore:     ranked[0].totalScore,
    avgScore:     Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 10) / 10,
    scoreRange:   { min: Math.min(...scores), max: Math.max(...scores) },
    weights:      WEIGHTS,
  };
}
