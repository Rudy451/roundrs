// /lib/pipeline/memoryStore.js
//
// Unified durable storage layer for DraftBoard.
//
// Owns three additional stores that were previously memory-only or missing:
//
//   PipelineRun   — complete record of every pipeline execution
//   ThemeHistory  — time series of theme scores across runs
//   SearchRunLog  — persisted search query audit trail
//
// Design rules:
//   - Append-only. Records are never modified after writing.
//   - Atomic writes: each write is a complete file replace, not a partial append.
//   - Consistent schema: every record has the same fields, no missing keys.
//   - Ring buffers with explicit caps — no unbounded growth.
//
// Relationship to existing stores:
//   snapshotStore.js   → .data/snapshots.json        (unchanged)
//   evaluationStore.js → .data/signal_records.json   (unchanged)
//                     → .data/evaluations.json        (unchanged)
//   data/store.js      → .data/store.json             (unchanged)
//   memoryStore.js     → .data/pipeline_runs.json     (NEW)
//                     → .data/theme_history.json      (NEW)
//                     → .data/search_run_logs.json    (NEW)

import fs   from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");

const FILES = {
  pipelineRuns:  path.join(DATA_DIR, "pipeline_runs.json"),
  themeHistory:  path.join(DATA_DIR, "theme_history.json"),
  searchRunLogs: path.join(DATA_DIR, "search_run_logs.json"),
};

// Ring buffer caps
const MAX_PIPELINE_RUNS  = 500;  // ~10 days at 30min cadence
const MAX_THEME_RECORDS  = 2000; // ~40 days at 30min with 4 themes
const MAX_SEARCH_LOGS    = 500;

// ─── In-memory mirrors ────────────────────────────────────────────────────────

let _runs    = [];
let _themes  = [];
let _search  = [];

// ─── I/O helpers ──────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch (e) {
    console.warn(`[memoryStore] Could not read ${file}:`, e.message);
  }
  return fallback;
}

function writeJson(file, data) {
  try {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.warn(`[memoryStore] Could not write ${file}:`, e.message);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function loadMemoryStore() {
  _runs   = readJson(FILES.pipelineRuns,  []);
  _themes = readJson(FILES.themeHistory,  []);
  _search = readJson(FILES.searchRunLogs, []);

  console.log(
    `[memoryStore] Loaded: ${_runs.length} pipeline runs, ` +
    `${_themes.length} theme records, ${_search.length} search logs`
  );
}

// ─── Schema 1: PipelineRun ────────────────────────────────────────────────────
//
// Complete record of one pipeline execution.
// Links to snapshot, signal records, and evaluation results via IDs.
//
// @typedef {Object} PipelineRun
// @property {string}   runId
// @property {number}   timestamp           — unix ms
// @property {boolean}  success
// @property {string|null} error
// @property {number}   durationMs
// @property {string|null} snapshotId       — links to snapshotStore
// @property {boolean}  dryRun
// @property {string[]} themes              — themes used in this run
// @property {number}   postsIngested
// @property {number}   postsFiltered
// @property {number}   uniqueTickers
// @property {number}   candidates          — shortlisted count
// @property {string|null} topTicker
// @property {number|null} topScore
// @property {object}   stageTimings        — ms per stage
// @property {CandidateSummary[]} candidateSummaries  — lightweight per-candidate record

/**
 * Record a completed pipeline run.
 *
 * @param {PipelineResult} result  — from runDiscoveryPipeline()
 * @param {object}         options — { dryRun, themes }
 */
export function recordPipelineRun(result, options = {}) {
  const run = {
    runId:       result.summary.runId,
    timestamp:   result.summary.timestamp,
    success:     result.success,
    error:       result.error ?? null,
    durationMs:  result.summary.durationMs,
    snapshotId:  result.summary.snapshotId ?? null,
    dryRun:      options.dryRun   ?? false,
    themes:      options.themes   ?? [],
    // Summary stats
    postsIngested:  result.summary.postsIngested  ?? 0,
    postsFiltered:  result.summary.postsFiltered  ?? 0,
    uniqueTickers:  result.summary.uniqueTickers  ?? 0,
    candidates:     result.summary.candidates     ?? 0,
    topTicker:      result.summary.topTicker      ?? null,
    topScore:       result.summary.topScore       ?? null,
    // Stage timings (extracted from meta.stages if available)
    stageTimings: extractStageTimings(result.meta?.stages ?? {}),
    // Lightweight candidate records — enough for history queries without full data
    candidateSummaries: (result.candidates ?? []).map(c => ({
      ticker:      c.ticker,
      score:       c.adjustedScore,
      signalType:  c.signalType,
      confidence:  c.confidence,
      mentions:    c.mentions,
      velocity:    c.velocity,
    })),
  };

  _runs.unshift(run);
  if (_runs.length > MAX_PIPELINE_RUNS) _runs = _runs.slice(0, MAX_PIPELINE_RUNS);
  writeJson(FILES.pipelineRuns, _runs);

  return run;
}

function extractStageTimings(stages) {
  const timings = {};
  for (const [stage, data] of Object.entries(stages)) {
    if (data?.durationMs != null) timings[stage] = data.durationMs;
  }
  return timings;
}

export function getPipelineRuns(limit = 50) {
  return _runs.slice(0, limit);
}

export function getPipelineRunById(runId) {
  return _runs.find(r => r.runId === runId) ?? null;
}

export function getRunsInRange(fromMs, toMs) {
  return _runs.filter(r => r.timestamp >= fromMs && r.timestamp <= toMs);
}

// ─── Schema 2: ThemeHistory ───────────────────────────────────────────────────
//
// Time series of theme scores from each pipeline run.
// Enables: "how has the uranium theme trended over the last 7 days?"
//
// @typedef {Object} ThemeRecord
// @property {string} theme
// @property {number} score           — theme intelligence score (0–100)
// @property {number} timestamp       — unix ms of the pipeline run
// @property {string} runId
// @property {number} querySlots      — how many search queries were allocated
// @property {boolean} crowded
// @property {boolean} emerging

/**
 * Record theme scores from a pipeline run.
 *
 * @param {string}   runId
 * @param {object[]} themeScores  — array of { theme, score, crowded, emerging, querySlots }
 */
export function recordThemeScores(runId, themeScores) {
  if (!themeScores || themeScores.length === 0) return;

  const timestamp = Date.now();
  const records   = themeScores.map(t => ({
    theme:      t.theme,
    score:      t.score       ?? 0,
    timestamp,
    runId,
    querySlots: t.querySlots  ?? 0,
    crowded:    t.crowded     ?? false,
    emerging:   t.emerging    ?? false,
  }));

  _themes.unshift(...records);
  if (_themes.length > MAX_THEME_RECORDS) _themes = _themes.slice(0, MAX_THEME_RECORDS);
  writeJson(FILES.themeHistory, _themes);
}

/**
 * Get score history for a specific theme.
 *
 * @param {string} theme
 * @param {number} limit
 * @returns {ThemeRecord[]} — newest first
 */
export function getThemeHistory(theme, limit = 48) {
  return _themes
    .filter(r => r.theme.toLowerCase() === theme.toLowerCase())
    .slice(0, limit);
}

/**
 * Get the most recent score for every theme.
 * @returns {{ [theme: string]: ThemeRecord }}
 */
export function getLatestThemeScores() {
  const seen   = new Set();
  const result = {};
  for (const record of _themes) {
    if (!seen.has(record.theme)) {
      seen.add(record.theme);
      result[record.theme] = record;
    }
  }
  return result;
}

/**
 * Get themes sorted by their most recent score.
 * @param {"desc"|"asc"} order
 * @returns {ThemeRecord[]}
 */
export function getThemeLeaderboard(order = "desc") {
  const latest = Object.values(getLatestThemeScores());
  return latest.sort((a, b) =>
    order === "desc" ? b.score - a.score : a.score - b.score
  );
}

// ─── Schema 3: SearchRunLog ───────────────────────────────────────────────────
//
// Persisted version of the in-memory search logs from searchLog.js.
// Enables: "which queries have consistently returned zero results?"
//
// @typedef {Object} SearchRunLog  (shape matches searchLog.js output)

export function persistSearchRunLog(log) {
  if (!log) return;

  _search.unshift(log);
  if (_search.length > MAX_SEARCH_LOGS) _search = _search.slice(0, MAX_SEARCH_LOGS);
  writeJson(FILES.searchRunLogs, _search);
}

export function getSearchRunLogs(limit = 20) {
  return _search.slice(0, limit);
}

// ─── Cross-cutting: ticker history ───────────────────────────────────────────
//
// Builds a time-series view of one ticker across all pipeline runs.
// Uses _runs (in-memory) as the primary source — no separate index needed.

/**
 * @typedef {Object} TickerHistoryEntry
 * @property {number}      timestamp
 * @property {string}      runId
 * @property {number}      score
 * @property {string}      signalType
 * @property {string}      confidence
 * @property {number}      mentions
 * @property {string}      velocity
 */

/**
 * Get the full appearance history of a ticker across pipeline runs.
 *
 * @param {string} ticker
 * @param {number} limit
 * @returns {TickerHistoryEntry[]} — newest first
 */
export function getTickerHistory(ticker, limit = 48) {
  const upper   = ticker.toUpperCase();
  const entries = [];

  for (const run of _runs) {
    const candidate = run.candidateSummaries?.find(c => c.ticker === upper);
    if (candidate) {
      entries.push({
        timestamp:  run.timestamp,
        runId:      run.runId,
        score:      candidate.score,
        signalType: candidate.signalType,
        confidence: candidate.confidence,
        mentions:   candidate.mentions,
        velocity:   candidate.velocity,
      });
    }
  }

  return entries.slice(0, limit);
}

/**
 * Get tickers that have appeared consistently across multiple recent runs.
 * Useful for identifying sustained attention vs. one-run spikes.
 *
 * @param {number} minRuns   — must appear in at least this many runs
 * @param {number} lookback  — look at this many recent runs (default 10)
 * @returns {Array<{ ticker, appearances, avgScore, latestScore }>}
 */
export function getSustainedTickers(minRuns = 3, lookback = 10) {
  const recentRuns = _runs.slice(0, lookback);
  const tickerMap  = new Map();

  for (const run of recentRuns) {
    for (const c of (run.candidateSummaries ?? [])) {
      if (!tickerMap.has(c.ticker)) {
        tickerMap.set(c.ticker, { scores: [], signalTypes: [] });
      }
      tickerMap.get(c.ticker).scores.push(c.score);
      tickerMap.get(c.ticker).signalTypes.push(c.signalType);
    }
  }

  return [...tickerMap.entries()]
    .filter(([, data]) => data.scores.length >= minRuns)
    .map(([ticker, data]) => ({
      ticker,
      appearances: data.scores.length,
      avgScore:    Math.round(data.scores.reduce((s, v) => s + v, 0) / data.scores.length * 10) / 10,
      latestScore: data.scores[0],
      dominantType: mode(data.signalTypes),
    }))
    .sort((a, b) => b.appearances - a.appearances || b.avgScore - a.avgScore);
}

function mode(arr) {
  const counts = {};
  for (const v of arr) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ─── Store summary ────────────────────────────────────────────────────────────

export function getMemoryStoreSummary() {
  const oldestRun = _runs.length > 0 ? _runs[_runs.length - 1].timestamp : null;
  const newestRun = _runs.length > 0 ? _runs[0].timestamp               : null;

  return {
    pipelineRuns: {
      count:   _runs.length,
      oldest:  oldestRun,
      newest:  newestRun,
      spanDays: oldestRun && newestRun
        ? Math.round((newestRun - oldestRun) / (24 * 3600 * 1000) * 10) / 10
        : 0,
    },
    themeHistory: {
      count:  _themes.length,
      themes: [...new Set(_themes.map(t => t.theme))],
    },
    searchRunLogs: {
      count: _search.length,
    },
  };
}

loadMemoryStore();
