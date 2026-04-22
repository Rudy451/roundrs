// /lib/pipeline/normalize.js
// Stage 2: Text normalization.
// Cleans post text before extraction to reduce false positives.

/*
 * Normalize a single post's text for ticker extraction.
 * Combines title + body, strips noise, preserves $ prefixes.
 *
 * @param {{ title: string, body: string }} post
 * @returns {string} cleaned text
 */
export function normalizePost(post) {
  let text = `${post.title} ${post.body}`

  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/www\.\S+/g, " ");

  // Remove Reddit formatting artifacts
  // Remove Reddit formatting artifacts
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/\[.*?\]\(.*?\)/g, " "); // markdown links
  text = text.replace(/#+\s/g, " ");           // headers

  // Preserve $TICKER patterns before stripping punctuation
  // Convert "$NVDA" → "NVDA" (we'll match uppercase after)
   text = text.replace(/\$([A-Z]{1,5})\b/g, " $1 ");

  // Remove punctuation except alphanumeric and spaces
  // Keep apostrophes out (TSLA's → TSLA s — we want TSLA)
  text = text.replace(/[^a-zA-Z0-9\s]/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/*
 * Normalize an array of posts.
 * @param {Post[]} posts
 * @returns {Array<{ post: Post, normalizedText: string }>}
  */
export function normalizePosts(posts) {
  return posts.map((post) => ({
    post,
    normalizedText: normalizePost(post),
  }));
}
