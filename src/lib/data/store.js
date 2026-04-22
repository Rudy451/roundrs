// /lib/data/store.js
// Lightweight in-memory store with optional JSON file persistence.
// Swap the persistence layer later (SQLite, Redis, etc.) without touching callers.

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

// ─── In-memory DB ─────────────────────────────────────────────────────────────
let db = {
  prices: {},    // { NVDA: [{ ticker, price, changePercent, timestamp }] }
  attention: {}, // { NVDA: [{ mentions, timestamp }] }
};

// ─── Persistence helpers ───────────────────────────────────────────────────────

/** Load store from disk on startup (safe — won't crash if missing). */
export function loadStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      db = JSON.parse(raw);
    }
  } catch (e) {
    console.warn("[store] Could not load store from disk:", e.message);
  }
}

/** Persist the current in-memory state to disk. Fire-and-forget. */
export function persistStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (e) {
    console.warn("[store] Could not persist store to disk:", e.message);
  }
}

// ─── Price helpers ─────────────────────────────────────────────────────────────

/**
 * Save an array of price entries to the store.
 * @param {Array<{ ticker, price, changePercent, timestamp }>} priceData
 */
export function savePrices(priceData) {
  priceData.forEach((p) => {
    if (!db.prices[p.ticker]) db.prices[p.ticker] = [];
    db.prices[p.ticker].push(p);
    // Cap history to last 500 entries per ticker
    if (db.prices[p.ticker].length > 500) db.prices[p.ticker].shift();
  });
  persistStore();
}

/**
 * Get the most recent price entry for a ticker.
 * @param {string} ticker
 * @returns {{ ticker, price, changePercent, timestamp } | undefined}
 */
export function getLatestPrice(ticker) {
  const arr = db.prices[ticker] || [];
  return arr[arr.length - 1];
}

/**
 * Get full price history for a ticker.
 * @param {string} ticker
 * @returns {Array}
 */
export function getPriceHistory(ticker) {
  return db.prices[ticker] || [];
}

// ─── Attention helpers ─────────────────────────────────────────────────────────

/**
 * Save an array of attention entries to the store.
 * @param {Array<{ ticker, mentions, timestamp }>} attentionData
 */
export function saveAttention(attentionData) {
  attentionData.forEach((a) => {
    if (!db.attention[a.ticker]) db.attention[a.ticker] = [];
    db.attention[a.ticker].push(a);
    if (db.attention[a.ticker].length > 500) db.attention[a.ticker].shift();
  });
  persistStore();
}

/**
 * Get the most recent attention entry for a ticker.
 * @param {string} ticker
 * @returns {{ ticker, mentions, timestamp } | undefined}
 */
export function getLatestAttention(ticker) {
  const arr = db.attention[ticker] || [];
  return arr[arr.length - 1];
}

// Load on module init (server-side only)
loadStore();
