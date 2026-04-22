// /lib/pipeline/post.js
//
// Canonical Post schema for the DraftBoard ingestion pipeline.
//
// All pipeline stages operate on this shape. Nothing enters the pipeline
// that hasn't been validated and shaped by createPost() or importRawPost().
//
// Rule: if a field is absent or malformed, supply a safe default.
//       Never throw on a missing field — log and continue.

import { edgeLog } from "./edgeLog.js";

// ─── Minimum content thresholds ───────────────────────────────────────────────

const MIN_TITLE_LENGTH      = 10;   // chars — filters "[removed]", empty titles
const MIN_COMBINED_LENGTH   = 20;   // title + body combined
const MIN_UPVOTES           = -100; // allow slightly negative (new posts)
const MAX_POST_AGE_HOURS    = 72;   // ignore posts older than 3 days

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Post
 * @property {string}   id              — Reddit post ID (e.g. "t3_abc123")
 * @property {string}   subreddit       — subreddit name without r/
 * @property {string}   title           — post title, trimmed
 * @property {string}   body            — selftext body, trimmed (may be empty for link posts)
 * @property {number}   upvotes         — current upvote score
 * @property {number}   numComments     — comment count at ingest time
 * @property {number}   createdUtc      — unix timestamp (seconds)
 * @property {string}   url             — full permalink
 * @property {string}   source          — "hot" | "theme" | "search"
 * @property {string|null} theme        — originating theme if source === "theme", else null
 * @property {string[]} extractedTickers — populated by extract stage, empty at ingest
 */

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Shape a raw Reddit API child object into a canonical Post.
 * Returns null if the post fails quality thresholds.
 *
 * @param {object} raw       — raw Reddit API data object (child.data)
 * @param {string} subreddit — subreddit name
 * @param {string} source    — "hot" | "theme" | "search"
 * @param {string|null} theme
 * @returns {Post|null}
 */
export function importRawPost(raw, subreddit, source = "hot", theme = null) {
  // ── Reject deleted / removed posts ────────────────────────────────────────
  if (!raw.id) {
    edgeLog("ingest", "missing_id", { subreddit });
    return null;
  }

  const title = (raw.title || "").trim();
  const body  = (raw.selftext || "").trim();

  if (
    title === "[removed]" ||
    title === "[deleted]" ||
    body  === "[removed]" ||
    body  === "[deleted]"
  ) {
    edgeLog("ingest", "removed_post", { id: raw.id, subreddit });
    return null;
  }

  // ── Reject thin content ───────────────────────────────────────────────────
  if (title.length < MIN_TITLE_LENGTH) {
    edgeLog("ingest", "title_too_short", { id: raw.id, title });
    return null;
  }

  if ((title + " " + body).length < MIN_COMBINED_LENGTH) {
    edgeLog("ingest", "content_too_short", { id: raw.id });
    return null;
  }

  // ── Reject stale posts ────────────────────────────────────────────────────
  const createdUtc = raw.created_utc || 0;
  const ageHours   = (Date.now() / 1000 - createdUtc) / 3600;

  if (ageHours > MAX_POST_AGE_HOURS) {
    edgeLog("ingest", "post_too_old", { id: raw.id, ageHours: Math.round(ageHours) });
    return null;
  }

  return {
    id:               raw.id,
    subreddit,
    title,
    body,
    upvotes:          typeof raw.score === "number"        ? raw.score        : 0,
    numComments:      typeof raw.num_comments === "number" ? raw.num_comments : 0,
    createdUtc,
    url:              raw.permalink ? `https://reddit.com${raw.permalink}` : "",
    source,
    theme,
    extractedTickers: [], // populated by extract stage
  };
}

/**
 * Validate that an object conforms to the Post schema.
 * Used to guard pipeline stage inputs.
 *
 * @param {unknown} obj
 * @returns {obj is Post}
 */
export function isValidPost(obj) {
  return (
    obj !== null &&
    typeof obj === "object" &&
    typeof obj.id          === "string" && obj.id.length > 0 &&
    typeof obj.subreddit   === "string" &&
    typeof obj.title       === "string" &&
    typeof obj.body        === "string" &&
    typeof obj.upvotes     === "number" &&
    typeof obj.createdUtc  === "number" &&
    Array.isArray(obj.extractedTickers)
  );
}

/**
 * Serialize a Post to a lean storage representation.
 * Drops fields not needed in memory/history.
 *
 * @param {Post} post
 * @returns {object}
 */
export function serializePost(post) {
  return {
    id:          post.id,
    subreddit:   post.subreddit,
    title:       post.title,
    upvotes:     post.upvotes,
    createdUtc:  post.createdUtc,
    url:         post.url,
    source:      post.source,
    theme:       post.theme,
    tickers:     post.extractedTickers,
  };
}
