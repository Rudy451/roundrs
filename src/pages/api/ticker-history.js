// /pages/api/pipeline/ticker-history.js
//
// GET /api/pipeline/ticker-history?ticker=NVDA          → full TickerHistory
// GET /api/pipeline/ticker-history?ticker=NVDA&summary=1 → compact summary only
// GET /api/pipeline/ticker-history?tickers=NVDA,AMD,SMCI → batch summaries

import {
  buildTickerHistory,
  buildTickerHistories,
  getTickerSummary,
} from "@/lib/pipeline/tickerHistory";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { ticker, tickers, summary } = req.query;

  // ── Batch summaries ───────────────────────────────────────────────────────
  if (tickers) {
    const list     = tickers.split(",").map(t => t.trim().toUpperCase()).filter(Boolean);
    const results  = list.map(t => getTickerSummary(t)).filter(Boolean);
    return res.status(200).json({ summaries: results, count: results.length });
  }

  // ── Single ticker ─────────────────────────────────────────────────────────
  if (!ticker) {
    return res.status(400).json({
      error: "ticker or tickers param required",
      examples: [
        "/api/pipeline/ticker-history?ticker=NVDA",
        "/api/pipeline/ticker-history?ticker=NVDA&summary=1",
        "/api/pipeline/ticker-history?tickers=NVDA,AMD,SMCI",
      ],
    });
  }

  const upper = ticker.toUpperCase();

  // Summary only (cheaper)
  if (summary === "1") {
    const result = getTickerSummary(upper);
    if (!result) return res.status(404).json({ error: `No history for ${upper}` });
    return res.status(200).json(result);
  }

  // Full history
  const snapshotLimit = Math.min(parseInt(req.query.snapshots ?? "96",  10), 200);
  const runLimit      = Math.min(parseInt(req.query.runs      ?? "200", 10), 500);

  const history = buildTickerHistory(upper, { snapshotLimit, runLimit });
  if (!history) {
    return res.status(404).json({ error: `No history for ${upper}` });
  }

  return res.status(200).json(history);
}
