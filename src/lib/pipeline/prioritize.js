// /lib/pipeline/prioritize.js  (v2)
//
// Deterministic signal scoring with six dimensions.
//
// Architecture doc rule: no AI here. Same input → same output. Always.
//
// Score flow:
//   1. base_score       — volume + velocity + theme  (v1 model, unchanged)
//   2. concentration    — source diversity (many posts vs. few) bonus/penalty
//   3. consistency      — temporal spread vs. spike detection
//   4. quality          — post depth + engagement proxy
//   5. penalty          — applied last, never cancels to below floor
//   6. final_score      — base adjusted by modifiers and penalty
//
// All intermediate scores are [0, 100].
// final_score is clamped to [0, 100].

// ─── Weight config ────────────────────────────────────────────────────────────
//
// BASE WEIGHTS (sum to 1.0 — controls base_score composition)
export const BASE_WEIGHTS = {
  mentions: 0.40,
  velocity: 0.35,
  theme:    0.25,
};

// MODIFIER WEIGHTS (how much each modifier shifts the base score)
// A modifier of +1.0 at weight 0.15 adds up to 15 points to final score.
export const MODIFIER_WEIGHTS = {
  concentration: 0.15,  // bonus for broad source diversity
  consistency:   0.12,  // bonus for steady mentions, penalty for pure spikes
  quality:       0.13,  // bonus for substantive posts
};

// PENALTY caps (how much a penalty can subtract, in points)
export const PENALTY_CAPS = {
  spike:      20,  // pure spike (all mentions in one burst) costs up to 20
  lowQuality: 15,  // low-quality post dominance costs up to 15
};

// Score floor — no ticker scores below this regardless of penalties
const SCORE_FLOOR = 5;

// Validate base weights at module load
const baseSum = Object.values(BASE_WEIGHTS).reduce((s, v) => s + v, 0);
if (Math.abs(baseSum - 1.0) > 0.001) {
  throw new Error(`[prioritize] BASE_WEIGHTS must sum to 1.0, got ${baseSum}`);
}

// ─── Base metrics (v1, unchanged) ────────────────────────────────────────────

function mentionsScore(mentions, maxMentions) {
  if (maxMentions === 0) return 0;
  return (mentions / maxMentions) * 100;
}

function velocityScore(signal, history, nowMs = Date.now()) {
  const current = signal.mentions;

  if (history.length >= 1) {
    const prevRecord = history[0].tickers.find(t => t.ticker === signal.ticker);
    const prev       = prevRecord?.mentions ?? 0;

    if (prev === 0) return Math.min(100, 50 + current * 10);

    const ratio = current / prev;
    if (ratio >= 3.0) return 100;
    if (ratio >= 1.0) return 50 + ((ratio - 1.0) / 2.0) * 50;
    if (ratio >= 0.5) return (ratio - 0.5) / 0.5 * 50;
    return 0;
  }

  const times      = signal.mentionTimes ?? [];
  const nowS       = Math.floor(nowMs / 1000);
  const last2h     = times.filter(t => t >= nowS - 7200).length;
  const last6h     = times.filter(t => t >= nowS - 21600).length;
  if (last6h === 0) return 25;
  return Math.round(25 + (last2h / last6h) * 75);
}

function themeScore(signal, themeScores) {
  const themes = [...new Set((signal.samplePosts ?? []).map(p => p.theme).filter(Boolean))];

  let alignment = 0;
  if (themes.length > 0 && Object.keys(themeScores).length > 0) {
    alignment = Math.max(...themes.map(t => themeScores[t] ?? 0));
  } else if (themes.length > 0) {
    alignment = 50;
  }

  const spread = Math.min(100, ((signal.uniqueSubreddits?.length ?? 1) - 1) * 50);
  return Math.round((alignment + spread) / 2);
}

// ─── New metric: Concentration score ─────────────────────────────────────────
//
// Measures source diversity — are mentions coming from many posts or a few?
//
// High concentration (1–2 posts driving all mentions) → lower score.
// A ticker genuinely gaining attention appears across many independent posts.
//
// Uses the Herfindahl-Hirschman Index (HHI) adapted for post distribution.
// HHI = sum of (post_share²) for each subreddit.
// HHI = 1.0 means single source (max concentration).
// HHI = 1/n means perfectly even (min concentration).
//
// We invert and normalize: score = (1 - HHI) × 100.
//
// Simple case: if only 1 post exists, score = 0 (single source, max concentration).

/**
 * @param {string[]} uniqueSubreddits — distinct subreddits from aggregation
 * @param {number}   postCount        — total posts mentioning this ticker
 * @param {object[]} samplePosts      — for subreddit distribution (top 3 only, proxy)
 * @returns {number} 0–100  (100 = perfectly spread, 0 = single source)
 */
function concentrationScore(uniqueSubreddits, postCount, samplePosts) {
  if (postCount <= 1) return 0; // single post — full concentration

  const numSubs = uniqueSubreddits.length;
  if (numSubs === 0) return 0;

  // Proxy: use samplePosts subreddit distribution as estimate of full distribution
  // This is an approximation (samplePosts is max 3) but deterministic and consistent
  const subCounts = {};
  for (const sub of uniqueSubreddits) subCounts[sub] = 0;

  // Count how many sample posts came from each subreddit
  for (const p of (samplePosts ?? [])) {
    if (p.subreddit && subCounts[p.subreddit] !== undefined) {
      subCounts[p.subreddit]++;
    }
  }

  // Fill any zero-count subreddits with 1 (floor assumption — they contributed)
  for (const sub of uniqueSubreddits) {
    if (subCounts[sub] === 0) subCounts[sub] = 1;
  }

  const total = Object.values(subCounts).reduce((s, v) => s + v, 0);
  const hhi   = Object.values(subCounts).reduce((s, v) => s + Math.pow(v / total, 2), 0);

  // Invert: hhi=1.0 → score=0, hhi=1/n → score≈100
  const score = (1 - hhi) * 100;

  // Bonus for absolute spread: 1 sub=0, 2=25, 3+=50 extra points
  const spreadBonus = Math.min(50, (numSubs - 1) * 25);

  return Math.min(100, Math.round(score + spreadBonus));
}

// ─── New metric: Consistency score ───────────────────────────────────────────
//
// Measures temporal distribution — is attention steady or a single spike?
//
// Steady attention over the window → HIGH score.
// All mentions in a short burst then silence → LOW score (likely event-driven noise).
//
// Method: divide the window into equal thirds and measure how evenly
// mentions are distributed across them.
// Even distribution (≈1/3 per bucket) → score near 100.
// All in one bucket → score near 0.
//
// Spike penalty is separate (applied later). This score purely measures spread.

/**
 * @param {number[]} mentionTimes — createdUtc (seconds) of each mention, sorted ASC
 * @param {number}   windowHours  — nominal window size
 * @returns {number} 0–100
 */
function consistencyScore(mentionTimes, windowHours = 6, nowMs = Date.now()) {
  if (!mentionTimes || mentionTimes.length === 0) return 50; // no data, neutral
  if (mentionTimes.length === 1) return 25; // single mention, low consistency

  const nowS        = Math.floor(nowMs / 1000);
  const windowStart = nowS - windowHours * 3600;
  const windowSize  = windowHours * 3600;
  const bucketSize  = windowSize / 3;

  // Count mentions in each third of the window
  const buckets = [0, 0, 0];
  for (const t of mentionTimes) {
    if (t < windowStart) continue; // outside window
    const offset = t - windowStart;
    const bucket = Math.min(2, Math.floor(offset / bucketSize));
    buckets[bucket]++;
  }

  const total = buckets.reduce((s, v) => s + v, 0);
  if (total === 0) return 50;

  // Normalize to fractions
  const fractions = buckets.map(v => v / total);

  // Ideal distribution: [1/3, 1/3, 1/3]
  // Measure deviation from ideal using sum of squared differences
  const ideal      = 1 / 3;
  const sumSqDiff  = fractions.reduce((s, f) => s + Math.pow(f - ideal, 2), 0);

  // Max possible sumSqDiff (all in one bucket): 2 × (1/3)² + 1 × (2/3)² ≈ 0.667
  const maxSumSqDiff = 2 * Math.pow(ideal, 2) + Math.pow(1 - ideal, 2);

  const evenness = 1 - (sumSqDiff / maxSumSqDiff);
  return Math.round(evenness * 100);
}

// ─── New metric: Quality score ────────────────────────────────────────────────
//
// Proxy for discussion substantiveness. No NLP, no AI.
// Uses structural signals available from post metadata.
//
// Components:
//   a. Body depth (40%)   — median body length of mentioning posts.
//      Short bodies (< 100 chars) = likely price reaction, not thesis.
//      Long bodies (> 500 chars)  = likely detailed analysis.
//
//   b. Engagement ratio (40%) — median (comments / upvotes).
//      High ratio = debate, discussion, responses.
//      Low ratio  = passive observation, no engagement.
//      Note: viral meme posts often have high engagement too — penalized separately.
//
//   c. Source diversity bonus (20%) — posts from non-WSB subreddits.
//      r/investing and r/stocks skew toward analysis vs. r/wallstreetbets.

/**
 * @param {number[]} bodyLengths       — char lengths of all mentioning post bodies
 * @param {number[]} engagementRatios  — comment/upvote ratio per post (capped at 5)
 * @param {string[]} uniqueSubreddits  — distinct subreddits
 * @returns {number} 0–100
 */
function qualityScore(bodyLengths, engagementRatios, uniqueSubreddits) {
  if (!bodyLengths || bodyLengths.length === 0) return 25; // no data

  // a. Body depth score
  const medianBody = median(bodyLengths);
  // 0–50 chars → 0, 50–200 → linear 0→50, 200–600 → linear 50→100, 600+ → 100
  let bodyScore;
  if (medianBody <= 50)       bodyScore = 0;
  else if (medianBody <= 200) bodyScore = ((medianBody - 50) / 150) * 50;
  else if (medianBody <= 600) bodyScore = 50 + ((medianBody - 200) / 400) * 50;
  else                        bodyScore = 100;

  // b. Engagement ratio score
  const medianRatio = median(engagementRatios ?? [0]);
  // 0–0.1 → 0, 0.1–0.5 → linear 0→60, 0.5–1.5 → linear 60→100, 1.5+ → 100
  let engagementScore;
  if (medianRatio <= 0.1)     engagementScore = 0;
  else if (medianRatio <= 0.5) engagementScore = ((medianRatio - 0.1) / 0.4) * 60;
  else if (medianRatio <= 1.5) engagementScore = 60 + ((medianRatio - 0.5) / 1.0) * 40;
  else                         engagementScore = 100;

  // c. Source diversity bonus
  const analysisSubreddits = ["stocks", "investing", "SecurityAnalysis", "ValueInvesting"];
  const hasAnalysisSub = (uniqueSubreddits ?? []).some(s => analysisSubreddits.includes(s));
  const diversityBonus = hasAnalysisSub ? 100 : 0;

  return Math.round(bodyScore * 0.40 + engagementScore * 0.40 + diversityBonus * 0.20);
}

// ─── Penalties ────────────────────────────────────────────────────────────────

/**
 * Compute penalty adjustments (returned as a negative number or zero).
 *
 * Two penalties:
 *   a. Spike penalty — all mentions clustered in a short window with nothing before/after.
 *      Catches: news-driven piles, pump posts, coordinated mentions.
 *      Applied when: > 80% of mentions occur within 30 minutes of each other.
 *
 *   b. Low-quality penalty — majority of posts are thin (short body, low engagement).
 *      Catches: meme reposts, "to the moon" posts, ticker mentions in passing.
 *      Applied when: > 60% of posts have body < 50 chars AND low engagement.
 *
 * @param {number[]} mentionTimes
 * @param {number[]} bodyLengths
 * @param {number[]} engagementRatios
 * @returns {{ total: number, spike: number, lowQuality: number }}  (all ≤ 0)
 */
function computePenalties(mentionTimes, bodyLengths, engagementRatios) {
  let spikePenalty      = 0;
  let lowQualityPenalty = 0;

  // Spike penalty
  if (mentionTimes && mentionTimes.length >= 3) {
    const sorted   = [...mentionTimes].sort((a, b) => a - b);
    const span     = sorted[sorted.length - 1] - sorted[0]; // total span in seconds
    const halfSpan = span / 2;

    // Find tightest cluster: count mentions within any 30-minute window
    const windowS    = 30 * 60;
    let maxInWindow  = 0;
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = sorted[i] + windowS;
      const count     = sorted.filter(t => t >= sorted[i] && t <= windowEnd).length;
      if (count > maxInWindow) maxInWindow = count;
    }

    const clusterRatio = maxInWindow / sorted.length;

    // > 80% in 30 minutes AND total span < 2 hours = spike
    if (clusterRatio > 0.8 && span < 7200) {
      // Scale penalty by how extreme the spike is
      spikePenalty = -Math.round(PENALTY_CAPS.spike * clusterRatio);
    }
  }

  // Low-quality penalty
  if (bodyLengths && bodyLengths.length >= 2) {
    const thinCount    = bodyLengths.filter(l => l < 50).length;
    const thinFraction = thinCount / bodyLengths.length;

    const lowEngagement = (engagementRatios ?? []).filter(r => r < 0.05).length;
    const lowEngFraction = lowEngagement / (engagementRatios?.length ?? 1);

    // Both thin body AND low engagement → compound penalty
    if (thinFraction > 0.6 && lowEngFraction > 0.5) {
      lowQualityPenalty = -Math.round(
        PENALTY_CAPS.lowQuality * ((thinFraction + lowEngFraction) / 2)
      );
    }
  }

  return {
    spike:      spikePenalty,
    lowQuality: lowQualityPenalty,
    total:      spikePenalty + lowQualityPenalty,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n) { return Math.round(n * 10) / 10; }

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Score and rank TickerSignals using the v2 model.
 *
 * @param {TickerSignal[]} signals
 * @param {object}         themeScores — { theme: 0–100 }
 * @returns {RankedTickerV2[]}
 */
export function prioritizeSignals(signals, themeScores = {}, {
  nowMs = Date.now(),
  windowHours = 6,
  historySnapshots,
} = {}) {
  if (!signals || signals.length === 0) return [];

  const history     = historySnapshots ?? [];
  const maxMentions = Math.max(...signals.map(s => s.mentions), 1);

  const scored = signals.map(signal => {

    // ── Base score (v1 components) ─────────────────────────────────────────
    const mScore   = mentionsScore(signal.mentions, maxMentions);
    const vScore   = velocityScore(signal, history, nowMs);
    const tScore   = themeScore(signal, themeScores);
    const baseScore = round1(
      mScore * BASE_WEIGHTS.mentions +
      vScore * BASE_WEIGHTS.velocity +
      tScore * BASE_WEIGHTS.theme
    );

    // ── New dimensions ─────────────────────────────────────────────────────
    const concScore = concentrationScore(
      signal.uniqueSubreddits ?? [],
      signal.postCount        ?? signal.mentions,
      signal.samplePosts      ?? []
    );

    const consScore = consistencyScore(
      signal.mentionTimes ?? [],
      windowHours,
      nowMs
    );

    const qualScore = qualityScore(
      signal.bodyLengths       ?? [],
      signal.engagementRatios  ?? [],
      signal.uniqueSubreddits  ?? []
    );

    // ── Penalties ──────────────────────────────────────────────────────────
    const penalties = computePenalties(
      signal.mentionTimes     ?? [],
      signal.bodyLengths      ?? [],
      signal.engagementRatios ?? []
    );

    // ── Final score ────────────────────────────────────────────────────────
    // base + modifier bonuses + penalty, clamped to [SCORE_FLOOR, 100]
    const modifierBonus =
      (concScore - 50) / 100 * MODIFIER_WEIGHTS.concentration * 100 +
      (consScore - 50) / 100 * MODIFIER_WEIGHTS.consistency   * 100 +
      (qualScore - 50) / 100 * MODIFIER_WEIGHTS.quality       * 100;

    const finalScore = round1(
      Math.max(SCORE_FLOOR, Math.min(100, baseScore + modifierBonus + penalties.total))
    );

    return {
      ticker:               signal.ticker,
      // V2 output shape
      baseScore,
      concentrationScore:   round1(concScore),
      consistencyScore:     round1(consScore),
      qualityScore:         round1(qualScore),
      penaltyAdjustment:    round1(penalties.total),
      finalScore,
      // Penalty breakdown
      penalties: {
        spike:      round1(penalties.spike),
        lowQuality: round1(penalties.lowQuality),
      },
      // Pass-through for display and Claude ranking
      mentions:     signal.mentions,
      velocity:     signal.velocity,
      avgUpvotes:   signal.avgUpvotes,
      lastSeen:     signal.lastSeen,
      samplePosts:  signal.samplePosts,
      // Legacy field alias so callers reading .totalScore still work
      totalScore:   finalScore,
      // Diagnostic breakdown
      _components: {
        mentionsScore: round1(mScore),
        velocityScore: round1(vScore),
        themeScore:    round1(tScore),
      },
    };
  });

  // Sort: finalScore DESC, then ticker ASC for deterministic tie-breaking
  return scored.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.ticker.localeCompare(b.ticker);
  });
}

/**
 * Summarize for run log.
 * @param {RankedTickerV2[]} ranked
 */
export function summarizePrioritization(ranked) {
  if (ranked.length === 0) return { count: 0 };

  const scores = ranked.map(r => r.finalScore);
  const penalized = ranked.filter(r => r.penaltyAdjustment < 0).length;

  return {
    count:        ranked.length,
    topTicker:    ranked[0].ticker,
    topScore:     ranked[0].finalScore,
    avgScore:     round1(scores.reduce((s, v) => s + v, 0) / scores.length),
    scoreRange:   { min: Math.min(...scores), max: Math.max(...scores) },
    penalized,
    weights:      { base: BASE_WEIGHTS, modifiers: MODIFIER_WEIGHTS, penaltyCaps: PENALTY_CAPS },
  };
}
