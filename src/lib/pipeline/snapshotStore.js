// /lib/pipeline/snapshotStore.js
//
// Snapshot persistence layer.
// Stores snapshots in a ring buffer in memory, persists to JSON on disk.
//
// Design:
//   - In-memory ring buffer: last MAX_SNAPSHOTS snapshots
//   - Disk persistence: .data/snapshots.json
//   - Lookup by snapshotId or index (0 = latest)
//   - Comparable snapshots: getByWindow(hours) returns all with matching windowHours

import fs   from "fs";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_SNAPSHOTS = 96;  // ~48h at 30min cadence with 6h windows
const DATA_DIR      = path.join(process.cwd(), ".data");
const STORE_FILE    = path.join(DATA_DIR, "snapshots.json");

// ─── In-memory ring buffer ────────────────────────────────────────────────────

// Ordered newest → oldest
let _snapshots = [];

// ─── Persistence ─────────────────────────────────────────────────────────────

export function loadSnapshots() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      const raw  = fs.readFileSync(STORE_FILE, "utf-8");
      _snapshots = JSON.parse(raw);
      console.log(`[snapshotStore] Loaded ${_snapshots.length} snapshots from disk`);
    }
  } catch (e) {
    console.warn("[snapshotStore] Could not load snapshots:", e.message);
    _snapshots = [];
  }
}

function persistSnapshots() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(_snapshots, null, 2), "utf-8");
  } catch (e) {
    console.warn("[snapshotStore] Could not persist snapshots:", e.message);
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Save a snapshot to the store.
 * Deduplicates by snapshotId — same snapshot is never stored twice.
 * Enforces MAX_SNAPSHOTS ring buffer.
 *
 * @param {Snapshot} snapshot
 */
export function saveSnapshot(snapshot) {
  // Dedup — don't store the same snapshot twice
  const exists = _snapshots.some(s => s.snapshotId === snapshot.snapshotId);
  if (exists) {
    console.debug(`[snapshotStore] Snapshot ${snapshot.snapshotId} already exists, skipping`);
    return;
  }

  // Prepend (newest first)
  _snapshots.unshift(snapshot);

  // Enforce ring buffer
  if (_snapshots.length > MAX_SNAPSHOTS) {
    _snapshots = _snapshots.slice(0, MAX_SNAPSHOTS);
  }

  persistSnapshots();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get the most recent snapshot.
 * @returns {Snapshot|null}
 */
export function getLatestSnapshot() {
  return _snapshots[0] ?? null;
}

/**
 * Get a snapshot by its ID.
 * @param {string} snapshotId
 * @returns {Snapshot|null}
 */
export function getSnapshotById(snapshotId) {
  return _snapshots.find(s => s.snapshotId === snapshotId) ?? null;
}

/**
 * Get the N most recent snapshots, optionally filtered by windowHours.
 *
 * @param {object} options
 * @param {number} options.limit       — max number to return (default 10)
 * @param {number} options.windowHours — filter to specific window size (optional)
 * @returns {Snapshot[]}
 */
export function getSnapshots({ limit = 10, windowHours } = {}) {
  let results = _snapshots;

  if (windowHours !== undefined) {
    results = results.filter(s => s.windowHours === windowHours);
  }

  return results.slice(0, limit);
}

/**
 * Get the previous snapshot relative to a given one.
 * Used for velocity calculations and diffing.
 *
 * @param {string} snapshotId
 * @returns {Snapshot|null}
 */
export function getPreviousSnapshot(snapshotId) {
  const idx = _snapshots.findIndex(s => s.snapshotId === snapshotId);
  if (idx === -1 || idx === _snapshots.length - 1) return null;
  return _snapshots[idx + 1]; // next in array = older in time
}

/**
 * Get all snapshots within a time range.
 *
 * @param {number} fromMs — start of range (unix ms)
 * @param {number} toMs   — end of range (unix ms)
 * @returns {Snapshot[]}
 */
export function getSnapshotsInRange(fromMs, toMs) {
  return _snapshots.filter(
    s => s.createdAt >= fromMs && s.createdAt <= toMs
  );
}

/**
 * Get summary stats about the store.
 */
export function getStoreStats() {
  if (_snapshots.length === 0) {
    return { count: 0, oldest: null, newest: null, windowBreakdown: {} };
  }

  const windowBreakdown = {};
  for (const s of _snapshots) {
    windowBreakdown[s.windowHours] = (windowBreakdown[s.windowHours] ?? 0) + 1;
  }

  return {
    count:           _snapshots.length,
    oldest:          _snapshots[_snapshots.length - 1]?.createdAt ?? null,
    newest:          _snapshots[0]?.createdAt ?? null,
    windowBreakdown,
  };
}

// Load on module init (server-side only)
loadSnapshots();
