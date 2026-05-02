// /lib/pipeline/searchLog.js
//
// Structured audit log for each search run.
// Tracks: what was planned, what executed, what each query returned,
// what was discarded, and why.
//
// One SearchRunLog is created per pipeline run and attached to the result.
// Persisted alongside the snapshot for post-run review.

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} QueryLog
 * @property {string}   theme          — originating theme
 * @property {string}   query          — query string as sent to Reddit
 * @property {string}   source         — "ai" | "static" | "template"
 * @property {string}   fingerprint    — dedup fingerprint
 * @property {number}   fetched        — raw posts returned by Reddit
 * @property {number}   afterGlobalDedup — posts remaining after cross-query dedup
 * @property {number}   afterQualityFilter — posts remaining after quality filter
 * @property {string}   yieldClass     — "high" | "normal" | "low"
 * @property {number}   durationMs     — time to execute this query
 * @property {number|null} httpStatus  — Reddit HTTP status (null if not attempted)
 * @property {string|null} error       — error message if query failed
 */

/**
 * @typedef {Object} SearchRunLog
 * @property {string}      runId           — matches the pipeline run ID
 * @property {number}      startedAt       — unix ms
 * @property {number}      completedAt     — unix ms
 * @property {string[]}    themesRequested — themes passed in
 * @property {object}      slotAllocation  — { theme: slotCount }
 * @property {number}      queriesPlanned  — before dedup
 * @property {number}      queriesExecuted — after dedup
 * @property {number}      queriesDiscarded — deduped out
 * @property {number}      totalFetched    — raw posts before any filtering
 * @property {number}      totalKept       — posts after global dedup
 * @property {number}      totalDiscarded  — posts removed
 * @property {QueryLog[]}  queries         — per-query detail
 * @property {string[]}    violations      — guardrail violations (should be empty)
 */

// ─── Builder ──────────────────────────────────────────────────────────────────

export function createSearchRunLog(runId, themesRequested) {
  return {
    runId,
    startedAt:        Date.now(),
    completedAt:      null,
    themesRequested:  [...themesRequested],
    slotAllocation:   {},
    queriesPlanned:   0,
    queriesExecuted:  0,
    queriesDiscarded: 0,
    totalFetched:     0,
    totalKept:        0,
    totalDiscarded:   0,
    queries:          [],
    violations:       [],
  };
}

export function logQueryResult(runLog, queryLog) {
  runLog.queries.push(queryLog);
  runLog.totalFetched    += queryLog.fetched;
  runLog.totalKept       += queryLog.afterQualityFilter;
  runLog.totalDiscarded  += (queryLog.fetched - queryLog.afterQualityFilter);
  runLog.queriesExecuted += queryLog.httpStatus !== null ? 1 : 0;
}

export function finalizeSearchRunLog(runLog) {
  runLog.completedAt = Date.now();
  return runLog;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * Produce a human-readable one-line summary of a search run log.
 * Used in console output and the scheduler monitor.
 *
 * @param {SearchRunLog} log
 * @returns {string}
 */
export function summarizeSearchRunLog(log) {
  const dur = log.completedAt
    ? `${log.completedAt - log.startedAt}ms`
    : "incomplete";

  const yieldBreakdown = log.queries
    .reduce((m, q) => { m[q.yieldClass] = (m[q.yieldClass] ?? 0) + 1; return m; }, {});

  return (
    `[searchLog] run=${log.runId} ` +
    `themes=${log.themesRequested.length} ` +
    `planned=${log.queriesPlanned} executed=${log.queriesExecuted} deduped=${log.queriesDiscarded} ` +
    `fetched=${log.totalFetched} kept=${log.totalKept} discarded=${log.totalDiscarded} ` +
    `yield=${JSON.stringify(yieldBreakdown)} ` +
    `dur=${dur}`
  );
}

// ─── In-memory log store ──────────────────────────────────────────────────────
// Keeps last 48 search run logs for inspection.

const MAX_LOGS = 48;
let _logs = [];

export function storeSearchRunLog(log) {
  _logs.unshift(log);
  if (_logs.length > MAX_LOGS) _logs = _logs.slice(0, MAX_LOGS);
}

export function getSearchRunLogs(limit = 10) {
  return _logs.slice(0, limit);
}

export function getLatestSearchRunLog() {
  return _logs[0] ?? null;
}
