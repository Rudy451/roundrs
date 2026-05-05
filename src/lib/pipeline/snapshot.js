// /lib/pipeline/snapshot.js
//
// Canonical Snapshot schema for DraftBoard.
//
// A snapshot is an atomic, immutable record of one complete pipeline run.
// It captures: the time window, every post ingested, every ticker found,
// and the aggregated signal for each ticker — all frozen at one moment.
//
// Guarantees:
//   - All posts fall within [windowStart, windowEnd]
//   - Every ticker mention is counted exactly once per post
//   - Ticker format is normalized (uppercase, trimmed) before storage
//   - snapshotId is deterministic given the same input set
//   - Two snapshots are comparable if their windowHours match

import crypto from "crypto";

// ─── Window config ────────────────────────────────────────────────────────────

export const DEFAULT_WINDOW_HOURS = 6;
export const WINDOW_OPTIONS = [1, 3, 6, 12, 24]; // valid window sizes

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TickerRecord
 * @property {string}   ticker          — normalized uppercase symbol
 * @property {number}   mentions        — total post count within window
 * @property {number[]} mentionTimes    — createdUtc of each contributing post (sorted ASC)
 * @property {number}   avgUpvotes      — mean upvote score of contributing posts
 * @property {string[]} postIds         — IDs of contributing posts (sorted)
 * @property {string[]} subreddits      — unique subreddits where mentioned (sorted)
 */

/**
 * @typedef {Object} Snapshot
 *
 * Immutable. Set once at build time; enriched before first save.
 * Never modified after saveSnapshot() is called.
 *
 * Core fields (set at Stage 4 — buildSnapshot):
 * @property {string}         snapshotId        — deterministic hash of postIds + windowStart
 * @property {number}         createdAt         — unix ms when snapshot was built
 * @property {number}         windowStart       — unix ms — earliest post in window
 * @property {number}         windowEnd         — unix ms — snapshot creation time
 * @property {number}         windowHours       — nominal window size (e.g. 6)
 * @property {number}         postCount         — number of posts included
 * @property {number}         tickerCount       — number of unique tickers found
 * @property {TickerRecord[]} tickers           — aggregated ticker records, mentions DESC
 * @property {Post[]}         rawPosts          — every post ingested in this window
 * @property {object}         meta              — ingest metadata
 *
 * Enriched fields (added before save, after later pipeline stages complete):
 * @property {object[]|null}  tickersRanked      — scored output from prioritize stage
 * @property {object[]|null}  tickersShortlisted — filtered output from shortlist stage
 * @property {object[]|null}  aiAnalysis         — Claude interpretations per ticker
 * @property {string[]}       themes             — themes active in this run
 * @property {boolean}        enriched           — true once enrichSnapshot() called
 */

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a canonical Snapshot from pipeline stage outputs.
 *
 * Steps:
 *   1. Enforce time window — drop posts outside [windowStart, windowEnd]
 *   2. Aggregate tickers — count mentions, collect timestamps and post IDs
 *   3. Normalize ticker format — uppercase, dedupe per post
 *   4. Sort deterministically — by mentions DESC, then ticker ASC for ties
 *   5. Generate snapshotId — hash of sorted postIds + windowStart
 *
 * @param {object} params
 * @param {Post[]}   params.posts        — all posts from ingest stage
 * @param {Array<{ post: Post, tickers: string[] }>} params.extracted — from extract stage
 * @param {number}   params.windowHours  — time window to enforce (default 6)
 * @param {object}   params.ingestMeta   — metadata from ingest stage
 * @returns {Snapshot}
 */
export function buildSnapshot({
  posts,
  extracted,
  windowHours = DEFAULT_WINDOW_HOURS,
  ingestMeta  = {},
}) {
  const createdAt    = Date.now();
  const windowEnd    = createdAt;
  const windowStartS = Math.floor(windowEnd / 1000) - windowHours * 3600; // in seconds
  const windowStart  = windowStartS * 1000; // in ms for storage

  // ── Step 1: Enforce time window ────────────────────────────────────────────
  // Build a set of post IDs that fall within the window.
  // Use createdUtc (seconds) from the canonical Post schema.

  const windowPostIds = new Set(
    posts
      .filter(p => p.createdUtc >= windowStartS)
      .map(p => p.id)
  );

  const windowedExtracted = extracted.filter(({ post }) =>
    windowPostIds.has(post.id)
  );

  // ── Step 2: Aggregate tickers ──────────────────────────────────────────────
  // Count each ticker once per post — never once per mention within a post.
  // This prevents a post that says "NVDA NVDA NVDA" from counting as 3 mentions.

  // map: ticker → { postIds: Set, mentionTimes: number[], upvotes: number[], subreddits: Set }
  const tickerMap = new Map();

  for (const { post, tickers } of windowedExtracted) {
    // Deduplicate tickers within this post before counting
    const uniqueTickersInPost = [...new Set(tickers.map(t => t.toUpperCase().trim()))];

    for (const ticker of uniqueTickersInPost) {
      if (!tickerMap.has(ticker)) {
        tickerMap.set(ticker, {
          postIds:      new Set(),
          mentionTimes: [],
          upvotes:      [],
          subreddits:   new Set(),
        });
      }

      const entry = tickerMap.get(ticker);

      // Guard against the same post being processed twice
      if (!entry.postIds.has(post.id)) {
        entry.postIds.add(post.id);
        entry.mentionTimes.push(post.createdUtc);
        entry.upvotes.push(post.upvotes);
        entry.subreddits.add(post.subreddit);
      }
    }
  }

  // ── Step 3: Shape into TickerRecord[] ─────────────────────────────────────

  const tickerRecords = [];

  for (const [ticker, data] of tickerMap) {
    const sortedPostIds   = [...data.postIds].sort();
    const sortedTimes     = [...data.mentionTimes].sort((a, b) => a - b);
    const sortedSubreddits = [...data.subreddits].sort();
    const avgUpvotes      = data.upvotes.length > 0
      ? Math.round(data.upvotes.reduce((s, v) => s + v, 0) / data.upvotes.length)
      : 0;

    tickerRecords.push({
      ticker,
      mentions:     sortedPostIds.length,
      mentionTimes: sortedTimes,
      avgUpvotes,
      postIds:      sortedPostIds,
      subreddits:   sortedSubreddits,
    });
  }

  // ── Step 4: Deterministic sort ─────────────────────────────────────────────
  // Primary: mentions DESC (highest attention first)
  // Secondary: ticker ASC (alphabetical for ties — deterministic)

  tickerRecords.sort((a, b) => {
    if (b.mentions !== a.mentions) return b.mentions - a.mentions;
    return a.ticker.localeCompare(b.ticker);
  });

  // ── Step 5: Generate snapshotId ────────────────────────────────────────────
  // Deterministic: same posts + same windowStart → same ID.
  // Input: sorted post IDs + windowStart seconds.

  const allPostIds = [...windowPostIds].sort().join(",");
  const idInput    = `${windowStartS}:${allPostIds}`;
  const snapshotId = crypto
    .createHash("sha256")
    .update(idInput)
    .digest("hex")
    .slice(0, 16); // first 16 chars is enough for uniqueness

  // ── Assemble ───────────────────────────────────────────────────────────────

  // rawPosts: all posts that fell within the window, serialized compactly.
  // Stored for debugging and backtesting. Body truncated to 500 chars to cap size.
  const rawPosts = posts
    .filter(p => windowPostIds.has(p.id))
    .map(p => ({
      id:          p.id,
      subreddit:   p.subreddit,
      title:       p.title,
      body:        p.body?.slice(0, 500) ?? "",
      upvotes:     p.upvotes,
      numComments: p.numComments,
      createdUtc:  p.createdUtc,
      source:      p.source,
      theme:       p.theme ?? null,
    }));

  return {
    snapshotId,
    createdAt,
    windowStart,
    windowEnd,
    windowHours,
    postCount:   windowPostIds.size,
    tickerCount: tickerRecords.length,
    tickers:     tickerRecords,
    rawPosts,
    // Enriched fields — populated by enrichSnapshot() before saveSnapshot()
    themes:              ingestMeta.themeSearch?.themes ?? [],
    tickersRanked:       null,
    tickersShortlisted:  null,
    aiAnalysis:          null,
    enriched:            false,
    meta: {
      subreddits:   ingestMeta.subreddits   ?? [],
      themes:       ingestMeta.themeSearch?.themes ?? [],
      hotPosts:     ingestMeta.hotPosts     ?? 0,
      themePosts:   ingestMeta.themePosts   ?? 0,
      dedupedOut:   ingestMeta.dedupedOut   ?? 0,
      perSubreddit: ingestMeta.perSubreddit ?? {},
    },
  };
}


// ─── Enrichment ───────────────────────────────────────────────────────────────
//
// Called in the runner AFTER stages 6–8 complete, BEFORE saveSnapshot().
// This is the one permitted mutation to a snapshot — it must happen before
// the first write to disk. After enrichSnapshot() the snapshot is complete
// and immutable.

/**
 * Enrich a snapshot with later pipeline stage outputs.
 * Must be called exactly once, before saveSnapshot().
 *
 * @param {Snapshot}      snapshot
 * @param {object}        enrichment
 * @param {object[]|null} enrichment.tickersRanked      — from prioritizeSignals()
 * @param {object[]|null} enrichment.tickersShortlisted — from buildShortlist().candidates
 * @param {object[]|null} enrichment.aiAnalysis         — from analyzeSignals()
 * @param {string[]}      enrichment.themes             — active themes this run
 * @returns {Snapshot} same object, mutated
 */
export function enrichSnapshot(snapshot, {
  tickersRanked      = null,
  tickersShortlisted = null,
  aiAnalysis         = null,
  themes             = [],
} = {}) {
  if (snapshot.enriched) {
    console.warn(`[snapshot] enrichSnapshot() called twice on ${snapshot.snapshotId} — skipping`);
    return snapshot;
  }

  snapshot.tickersRanked = tickersRanked
    ? tickersRanked.map(r => ({
        ticker:             r.ticker,
        finalScore:         r.finalScore,
        baseScore:          r.baseScore,
        concentrationScore: r.concentrationScore,
        consistencyScore:   r.consistencyScore,
        qualityScore:       r.qualityScore,
        penaltyAdjustment:  r.penaltyAdjustment,
        mentions:           r.mentions,
        velocity:           r.velocity,
      }))
    : null;

  snapshot.tickersShortlisted = tickersShortlisted
    ? tickersShortlisted.map(c => ({
        ticker:           c.ticker,
        adjustedScore:    c.adjustedScore,
        signalType:       c.signalType,
        confidence:       c.confidence,
        narrativeSummary: c.narrativeSummary ?? null,
        keyCatalyst:      c.keyCatalyst      ?? null,
        keyRisk:          c.keyRisk          ?? null,
        mentions:         c.mentions,
        velocity:         c.velocity,
        appliedRules:     c.appliedRules     ?? [],
      }))
    : null;

  snapshot.aiAnalysis = aiAnalysis ?? null;
  snapshot.themes     = themes;
  snapshot.enriched   = true;

  return snapshot;
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate that a snapshot is internally consistent.
 * Returns an array of violation strings. Empty = valid.
 *
 * @param {Snapshot} snapshot
 * @param {object}   options
 * @param {boolean}  options.requireEnriched — warn if enrichSnapshot() not yet called
 * @returns {string[]}
 */
export function validateSnapshot(snapshot, { requireEnriched = false } = {}) {
  const errors = [];

  if (!snapshot.snapshotId || snapshot.snapshotId.length !== 16) {
    errors.push("invalid snapshotId");
  }

  if (snapshot.windowStart >= snapshot.windowEnd) {
    errors.push("windowStart must be before windowEnd");
  }

  if (!WINDOW_OPTIONS.includes(snapshot.windowHours)) {
    errors.push(`windowHours must be one of: ${WINDOW_OPTIONS.join(", ")}`);
  }

  if (!Array.isArray(snapshot.rawPosts)) {
    errors.push("rawPosts must be an array");
  }

  if (requireEnriched && !snapshot.enriched) {
    errors.push("snapshot not enriched — call enrichSnapshot() before saving");
  }

  if (!Array.isArray(snapshot.tickers)) {
    errors.push("tickers must be an array");
  } else {
    // Check sort order
    for (let i = 1; i < snapshot.tickers.length; i++) {
      const prev = snapshot.tickers[i - 1];
      const curr = snapshot.tickers[i];
      if (
        curr.mentions > prev.mentions ||
        (curr.mentions === prev.mentions && curr.ticker < prev.ticker)
      ) {
        errors.push(`tickers not sorted correctly at index ${i}`);
        break;
      }
    }

    // Check per-record consistency
    for (const rec of snapshot.tickers) {
      if (rec.mentions !== rec.postIds.length) {
        errors.push(`${rec.ticker}: mentions (${rec.mentions}) != postIds.length (${rec.postIds.length})`);
      }
      if (rec.mentions !== rec.mentionTimes.length) {
        errors.push(`${rec.ticker}: mentions (${rec.mentions}) != mentionTimes.length`);
      }
      // Ticker must be uppercase
      if (rec.ticker !== rec.ticker.toUpperCase()) {
        errors.push(`${rec.ticker}: ticker is not uppercase`);
      }
    }
  }

  return errors;
}

// ─── Comparison helpers ───────────────────────────────────────────────────────

/**
 * Compare two snapshots and return the delta per ticker.
 * Only valid if both snapshots have the same windowHours.
 *
 * @param {Snapshot} prev
 * @param {Snapshot} curr
 * @returns {Array<{ ticker, prevMentions, currMentions, delta, pctChange }>}
 */
export function diffSnapshots(prev, curr) {
  if (prev.windowHours !== curr.windowHours) {
    throw new Error(
      `Cannot diff snapshots with different windowHours: ${prev.windowHours} vs ${curr.windowHours}`
    );
  }

  const prevMap = new Map(prev.tickers.map(t => [t.ticker, t.mentions]));
  const currMap = new Map(curr.tickers.map(t => [t.ticker, t.mentions]));
  const allTickers = new Set([...prevMap.keys(), ...currMap.keys()]);

  return [...allTickers]
    .map(ticker => {
      const p = prevMap.get(ticker) ?? 0;
      const c = currMap.get(ticker) ?? 0;
      const delta = c - p;
      const pctChange = p === 0
        ? (c > 0 ? 100 : 0)
        : Math.round((delta / p) * 100);
      return { ticker, prevMentions: p, currMentions: c, delta, pctChange };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)); // largest change first
}
