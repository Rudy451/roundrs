// /lib/pipeline/evaluationStore.js
//
// Stores two types of records:
//
//   SignalRecord  — snapshot of a candidate at the moment it was surfaced.
//                   Written when the pipeline produces a shortlist.
//
//   EvaluationResult — outcome measured after the evaluation window.
//                      Written by evaluate.js on its scheduled run.
//
// Both are append-only. Records are never modified after writing.
// Signal records without evaluations are "pending".

import fs   from "fs";
import path from "path";
import {
  SNAPSHOT_RETENTION_HOURS,
  SNAPSHOT_RETENTION_MS,
} from "./snapshotStore.js";

const DATA_DIR         = path.join(process.cwd(), ".data");
const SIGNALS_FILE     = path.join(DATA_DIR, "signal_records.json");
const EVALUATIONS_FILE = path.join(DATA_DIR, "evaluations.json");
const MAX_RECORDS      = 2000; // ring cap per store

export const EVALUATION_WINDOWS = {
  "24h": 24 * 3600 * 1000,
  "72h": 72 * 3600 * 1000,
};

export const DEFAULT_EVAL_WINDOWS = ["24h", "72h"];
export const MAX_EVALUATION_WINDOW_MS = Math.max(...Object.values(EVALUATION_WINDOWS));
export const MAX_EVALUATION_WINDOW_HOURS = MAX_EVALUATION_WINDOW_MS / (3600 * 1000);

export function assertEvaluationRetentionConfig() {
  if (MAX_EVALUATION_WINDOW_MS > SNAPSHOT_RETENTION_MS) {
    const message =
      `[evaluationStore] Evaluation window (${MAX_EVALUATION_WINDOW_HOURS}h) ` +
      `exceeds snapshot retention (${SNAPSHOT_RETENTION_HOURS}h). ` +
      "Increase snapshot retention before evaluating signals.";
    console.error(message);
    throw new Error(message);
  }
}

assertEvaluationRetentionConfig();

// ─── In-memory stores ─────────────────────────────────────────────────────────

let _signals     = []; // SignalRecord[]     — newest first
let _evaluations = []; // EvaluationResult[] — newest first

// ─── Persistence helpers ──────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback = []) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.warn(`[evaluationStore] Could not read ${file}:`, e.message);
  }
  return fallback;
}

function writeJson(file, data) {
  try {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.warn(`[evaluationStore] Could not write ${file}:`, e.message);
  }
}

// ─── Load on startup ──────────────────────────────────────────────────────────

export function loadEvaluationStore() {
  _signals     = readJson(SIGNALS_FILE,     []);
  _evaluations = readJson(EVALUATIONS_FILE, []);
  console.log(`[evaluationStore] Loaded ${_signals.length} signals, ${_evaluations.length} evaluations`);
}

// ─── Signal records ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} SignalRecord
 * @property {string}      recordId       — unique ID for this surfacing event
 * @property {string}      ticker
 * @property {number}      surfacedAt     — unix ms when pipeline ran
 * @property {string}      snapshotId     — pipeline snapshot that produced this signal
 * @property {number}      adjustedScore
 * @property {string}      signalType     — thesis | news | hype | mixed | unknown
 * @property {string}      confidence     — high | medium | low
 * @property {string|null} narrativeSummary
 * @property {string|null} keyCatalyst
 * @property {number}      mentionsAtSurface
 * @property {string}      velocity       — high | medium | low
 * @property {object}      scoreBreakdown
 * @property {string[]}    evalWindows    — ["24h","72h"] windows to evaluate at
 */

/**
 * Record a surfaced candidate for later evaluation.
 *
 * @param {FinalCandidate} candidate
 * @param {string}         snapshotId
 * @param {string[]}       evalWindows — default ["24h","72h"]
 * @returns {SignalRecord}
 */
export function recordSignal(candidate, snapshotId, evalWindows = DEFAULT_EVAL_WINDOWS) {
  assertEvaluationRetentionConfig();
  const recordId = `sig_${candidate.ticker}_${Date.now()}`;

  const record = {
    recordId,
    ticker:           candidate.ticker,
    surfacedAt:       Date.now(),
    snapshotId,
    adjustedScore:    candidate.adjustedScore,
    signalType:       candidate.signalType,
    confidence:       candidate.confidence,
    narrativeSummary: candidate.narrativeSummary ?? null,
    keyCatalyst:      candidate.keyCatalyst      ?? null,
    mentionsAtSurface: candidate.mentions        ?? 0,
    velocity:         candidate.velocity         ?? "unknown",
    scoreBreakdown:   candidate.scoreBreakdown   ?? {},
    evalWindows,
    evaluatedWindows: [], // filled in as evaluations complete
  };

  _signals.unshift(record);
  if (_signals.length > MAX_RECORDS) _signals = _signals.slice(0, MAX_RECORDS);

  writeJson(SIGNALS_FILE, _signals);
  return record;
}

/**
 * Record a batch of candidates from one pipeline run.
 *
 * @param {FinalCandidate[]} candidates
 * @param {string}           snapshotId
 * @returns {SignalRecord[]}
 */
export function recordSignals(candidates, snapshotId) {
  return candidates.map(c => recordSignal(c, snapshotId));
}

/**
 * Get signal records that are due for evaluation at a given window.
 *
 * @param {string} window — "24h" | "72h"
 * @returns {SignalRecord[]}
 */
export function getPendingEvaluations(window) {
  assertEvaluationRetentionConfig();
  const windowMs    = parseWindowMs(window);
  const now         = Date.now();
  const windowLabel = window;

  return _signals.filter(record => {
    // Must include this window in its eval plan
    if (!record.evalWindows.includes(windowLabel)) return false;

    // Must not already have been evaluated at this window
    if (record.evaluatedWindows.includes(windowLabel)) return false;

    // Window must have elapsed
    const elapsed = now - record.surfacedAt;
    return elapsed >= windowMs;
  });
}

/**
 * Mark a signal record as evaluated at a given window.
 * Called after evaluation is written so it won't be re-evaluated.
 */
export function markEvaluated(recordId, window) {
  const record = _signals.find(s => s.recordId === recordId);
  if (record && !record.evaluatedWindows.includes(window)) {
    record.evaluatedWindows.push(window);
    writeJson(SIGNALS_FILE, _signals);
  }
}

export function getSignalRecord(recordId) {
  return _signals.find(s => s.recordId === recordId) ?? null;
}

export function getSignalsByTicker(ticker, limit = 20) {
  return _signals.filter(s => s.ticker === ticker).slice(0, limit);
}

export function getAllSignals(limit = 100) {
  return _signals.slice(0, limit);
}

// ─── Evaluation results ───────────────────────────────────────────────────────

/**
 * @typedef {Object} EvaluationResult
 * @property {string}  evalId
 * @property {string}  recordId         — links to SignalRecord
 * @property {string}  ticker
 * @property {string}  window           — "24h" | "72h"
 * @property {number}  evaluatedAt
 * @property {number}  initialScore
 * @property {string}  initialSignalType
 * @property {number}  mentionsAtSurface
 *
 * Outcome metrics:
 * @property {number}  mentionsAtEval    — mentions in eval snapshot
 * @property {number}  attentionRatio    — mentionsAtEval / mentionsAtSurface
 * @property {string}  attentionTrend    — "rising" | "sustained" | "fading" | "gone"
 * @property {boolean} crossSubreddit    — appeared in 2+ subreddits at eval time
 * @property {number}  snapshotsCounted  — how many snapshots had this ticker
 * @property {number}  consistencyScore  — fraction of intervening snapshots with any mention
 *
 * Outcome classification:
 * @property {string}  outcome           — "confirmed" | "noise" | "inconclusive"
 * @property {number}  outcomeScore      — 0–100 composite outcome quality
 * @property {boolean} successFlag       — true if outcome === "confirmed"
 * @property {string}  outcomeReason     — human-readable explanation
 */

export function saveEvaluation(result) {
  _evaluations.unshift(result);
  if (_evaluations.length > MAX_RECORDS) _evaluations = _evaluations.slice(0, MAX_RECORDS);
  writeJson(EVALUATIONS_FILE, _evaluations);
}

export function getEvaluationsForTicker(ticker, limit = 20) {
  return _evaluations.filter(e => e.ticker === ticker).slice(0, limit);
}

export function getEvaluationsForRecord(recordId) {
  return _evaluations.filter(e => e.recordId === recordId);
}

export function getAllEvaluations(limit = 100) {
  return _evaluations.slice(0, limit);
}

/**
 * Get accuracy statistics across all completed evaluations.
 * Used by the feedback loop to adjust signal weights over time.
 */
export function getAccuracyStats() {
  if (_evaluations.length === 0) {
    return { total: 0, confirmed: 0, noise: 0, inconclusive: 0, accuracy: null };
  }

  const confirmed    = _evaluations.filter(e => e.outcome === "confirmed").length;
  const noise        = _evaluations.filter(e => e.outcome === "noise").length;
  const inconclusive = _evaluations.filter(e => e.outcome === "inconclusive").length;

  // Accuracy = confirmed / (confirmed + noise) — excludes inconclusive
  const decidable = confirmed + noise;
  const accuracy  = decidable > 0 ? Math.round((confirmed / decidable) * 100) : null;

  // Break down by signal type
  const bySignalType = {};
  for (const e of _evaluations) {
    const type = e.initialSignalType ?? "unknown";
    if (!bySignalType[type]) bySignalType[type] = { confirmed: 0, noise: 0, inconclusive: 0 };
    bySignalType[type][e.outcome]++;
  }

  return {
    total:         _evaluations.length,
    confirmed,
    noise,
    inconclusive,
    accuracy,
    bySignalType,
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export function parseWindowMs(window) {
  return EVALUATION_WINDOWS[window] ?? EVALUATION_WINDOWS["24h"];
}

loadEvaluationStore();
