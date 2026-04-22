// /lib/pipeline/edgeLog.js
//
// Structured logger for pipeline edge cases.
// Keeps a bounded in-memory log of unusual events for review.
// Does not throw — all logging is advisory.
//
// Usage:
//   edgeLog("ingest", "removed_post", { id: "abc123", subreddit: "stocks" });
//   getEdgeLog()  → last N entries
//   getEdgeStats() → count by stage + reason

const MAX_ENTRIES = 500;

let _log = [];

/**
 * Log an edge case event.
 *
 * @param {string} stage   — pipeline stage: "ingest" | "clean" | "extract"
 * @param {string} reason  — snake_case reason code
 * @param {object} context — any relevant context (id, ticker, value, etc.)
 */
export function edgeLog(stage, reason, context = {}) {
  const entry = {
    ts:      Date.now(),
    stage,
    reason,
    ...context,
  };

  _log.push(entry);

  // Cap to prevent unbounded growth
  if (_log.length > MAX_ENTRIES) {
    _log = _log.slice(-MAX_ENTRIES);
  }

  // Also emit to console in development
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[edge:${stage}] ${reason}`, context);
  }
}

/**
 * Get the full edge log, newest first.
 * @param {number} limit
 * @returns {object[]}
 */
export function getEdgeLog(limit = 100) {
  return [..._log].reverse().slice(0, limit);
}

/**
 * Get edge case counts grouped by stage and reason.
 * Useful for identifying systematic issues.
 *
 * @returns {{ [stage: string]: { [reason: string]: number } }}
 */
export function getEdgeStats() {
  const stats = {};
  for (const entry of _log) {
    if (!stats[entry.stage])          stats[entry.stage]          = {};
    if (!stats[entry.stage][entry.reason]) stats[entry.stage][entry.reason] = 0;
    stats[entry.stage][entry.reason]++;
  }
  return stats;
}

/**
 * Clear the log. Called between pipeline runs to keep stats per-run.
 */
export function clearEdgeLog() {
  _log = [];
}
