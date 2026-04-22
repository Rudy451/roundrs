// /lib/pipeline/normalize.js
// Stage 2: Data cleaning and text normalization.
//
// Responsibilities:
//   1. Filter low-quality posts (thin content, bots, crossposts)
//   2. Normalize text for ticker extraction
//   3. Log edge cases for review
//
// Input:  Post[] (from ingest stage)
// Output: Array<{ post: Post, normalizedText: string }>
//         — only posts that passed quality filters

import { edgeLog } from "./edgeLog.js";

// ─── Quality thresholds ───────────────────────────────────────────────────────

const MIN_UPVOTES_FOR_BODY_POSTS  = -50;   // body posts need some upvotes
const MIN_TITLE_WORDS             = 4;     // filter single-word titles
const MAX_TITLE_LENGTH            = 500;   // filter spam/SEO walls of text
const CROSSPOST_SIMILARITY_WORDS  = 8;     // matching word count = probable crosspost

// ─── Bot / spam patterns ──────────────────────────────────────────────────────
// Title prefixes/patterns that reliably indicate automated or low-value posts.

const BOT_PATTERNS = [
  /^daily discussion/i,
  /^weekly thread/i,
  /^what are your moves/i,
  /^rate my portfolio/i,
  /^\[deleted\]/i,
  /^\[removed\]/i,
  /^bot notice/i,
  /^automoderator/i,
];

// ─── Text normalization ───────────────────────────────────────────────────────

/**
 * Normalize a post's combined title + body text for ticker extraction.
 * Preserves $TICKER patterns, strips noise.
 *
 * @param {string} title
 * @param {string} body
 * @returns {string} — uppercase, cleaned, single-spaced
 */
export function normalizeText(title, body) {
  let text = `${title} ${body}`;

  // Remove URLs (before other processing to avoid partial matches)
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/www\.\S+/g, " ");

  // Decode Reddit HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&nbsp;/g, " ");

  // Strip Reddit markdown formatting
  text = text.replace(/\[.*?\]\(.*?\)/g, " "); // [text](url)
  text = text.replace(/#+\s/g, " ");            // ### headers
  text = text.replace(/\*{1,3}(.*?)\*{1,3}/g, " $1 "); // *bold/italic*
  text = text.replace(/_{1,2}(.*?)_{1,2}/g, " $1 ");    // _italic_
  text = text.replace(/`{1,3}[^`]*`{1,3}/g, " ");       // `code`
  text = text.replace(/^>\s.*/gm, " ");                  // > blockquotes

  // Preserve $TICKER before stripping punctuation
  // "$NVDA" → " NVDA " so it survives the punctuation strip
  text = text.replace(/\$([A-Za-z]{1,5})\b/g, " $1 ");

  // Strip everything except alphanumeric and spaces
  text = text.replace(/[^a-zA-Z0-9\s]/g, " ");

  // Uppercase and collapse whitespace
  text = text.toUpperCase().replace(/\s+/g, " ").trim();

  return text;
}

// ─── Quality filter ───────────────────────────────────────────────────────────

/**
 * Determine if a post passes quality thresholds.
 * Returns the rejection reason or null if the post is acceptable.
 *
 * @param {Post} post
 * @returns {string|null} — rejection reason or null
 */
function qualityRejectionReason(post) {
  const { title, body, upvotes } = post;

  // Bot/automated post patterns
  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(title)) return "bot_pattern";
  }

  // Title too short (word count)
  const titleWords = title.trim().split(/\s+/).filter(Boolean);
  if (titleWords.length < MIN_TITLE_WORDS) return "title_too_short";

  // Title too long (spam/SEO)
  if (title.length > MAX_TITLE_LENGTH) return "title_too_long";

  // Very low upvotes on body posts (body posts with deeply negative scores are usually low quality)
  if (body.length > 50 && upvotes < MIN_UPVOTES_FOR_BODY_POSTS) return "low_upvotes";

  return null; // passes
}

// ─── Crosspost detection ──────────────────────────────────────────────────────

/**
 * Detect probable crossposts within a batch using title word overlap.
 * Two posts with >= CROSSPOST_SIMILARITY_WORDS identical words in their titles
 * are considered the same content. The lower-scored post is dropped.
 *
 * This is intentionally conservative — we only drop near-duplicates.
 *
 * @param {Post[]} posts
 * @returns {Post[]} — posts with crossposts removed
 */
function deduplicateCrossposts(posts) {
  // Build word fingerprints for each post title
  const fingerprints = posts.map(p => ({
    post: p,
    words: new Set(
      p.title
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 3) // ignore short words for fingerprinting
    ),
  }));

  const dropped = new Set();

  for (let i = 0; i < fingerprints.length; i++) {
    if (dropped.has(i)) continue;
    for (let j = i + 1; j < fingerprints.length; j++) {
      if (dropped.has(j)) continue;

      const a = fingerprints[i];
      const b = fingerprints[j];

      // Count word overlap
      let overlap = 0;
      for (const word of a.words) {
        if (b.words.has(word)) overlap++;
      }

      if (overlap >= CROSSPOST_SIMILARITY_WORDS) {
        // Drop the lower-scored post
        const dropIdx = a.post.upvotes >= b.post.upvotes ? j : i;
        dropped.add(dropIdx);
        edgeLog("clean", "crosspost_removed", {
          kept:    fingerprints[dropIdx === i ? j : i].post.id,
          dropped: fingerprints[dropIdx].post.id,
          overlap,
        });
      }
    }
  }

  return posts.filter((_, idx) => !dropped.has(idx));
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Clean and normalize an array of posts.
 *
 * Pipeline:
 *   1. Quality filter (bot patterns, thin content, low upvotes)
 *   2. Crosspost deduplication (title fingerprint overlap)
 *   3. Text normalization (for ticker extraction)
 *
 * @param {Post[]} posts
 * @returns {Array<{ post: Post, normalizedText: string }>}
 */
export function normalizePosts(posts) {
  // Stage 1 — quality filter
  const qualityPassed = [];
  for (const post of posts) {
    const reason = qualityRejectionReason(post);
    if (reason) {
      edgeLog("clean", reason, { id: post.id, subreddit: post.subreddit });
    } else {
      qualityPassed.push(post);
    }
  }

  // Stage 2 — crosspost deduplication
  const deduplicated = deduplicateCrossposts(qualityPassed);

  // Stage 3 — text normalization
  return deduplicated.map(post => ({
    post,
    normalizedText: normalizeText(post.title, post.body),
  }));
}

// Re-export normalizeText for direct use in browser-side components
export { normalizeText as normalizePost };
