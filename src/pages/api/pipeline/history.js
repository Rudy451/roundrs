// /pages/api/pipeline/history.js
//
// Unified history query endpoint.
//
// GET /api/pipeline/history                       → store summary
// GET /api/pipeline/history?ticker=NVDA           → ticker appearance history
// GET /api/pipeline/history?ticker=NVDA&evals=1   → ticker + evaluations
// GET /api/pipeline/history?theme=AI              → theme score history
// GET /api/pipeline/history?themes=1              → latest score for all themes
// GET /api/pipeline/history?leaderboard=1         → themes ranked by current score
// GET /api/pipeline/history?sustained=1           → tickers in multiple recent runs
// GET /api/pipeline/history?runs=1&limit=20       → recent pipeline run records
// GET /api/pipeline/history?runs=1&from=MS&to=MS  → runs in time range

import {
  getTickerHistory,
  getThemeHistory,
  getLatestThemeScores,
  getThemeLeaderboard,
  getSustainedTickers,
  getPipelineRuns,
  getRunsInRange,
  getMemoryStoreSummary,
} from "@/lib/pipeline/memoryStore";

import { getEvaluationsForTicker } from "@/lib/pipeline/evaluationStore";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const q = req.query;

  // ── Store summary ─────────────────────────────────────────────────────────
  if (!Object.keys(q).length) {
    return res.status(200).json({ summary: getMemoryStoreSummary() });
  }

  // ── Ticker history ────────────────────────────────────────────────────────
  if (q.ticker) {
    const ticker = q.ticker.toUpperCase();
    const limit  = parseInt(q.limit ?? "48", 10);
    const history = getTickerHistory(ticker, limit);

    if (q.evals === "1") {
      const evaluations = getEvaluationsForTicker(ticker);
      return res.status(200).json({ ticker, history, evaluations });
    }

    return res.status(200).json({ ticker, history, count: history.length });
  }

  // ── Theme history ─────────────────────────────────────────────────────────
  if (q.theme) {
    const limit   = parseInt(q.limit ?? "48", 10);
    const history = getThemeHistory(q.theme, limit);
    return res.status(200).json({ theme: q.theme, history, count: history.length });
  }

  // ── Latest score for all themes ───────────────────────────────────────────
  if (q.themes === "1") {
    return res.status(200).json({ themes: getLatestThemeScores() });
  }

  // ── Theme leaderboard ─────────────────────────────────────────────────────
  if (q.leaderboard === "1") {
    const order = q.order === "asc" ? "asc" : "desc";
    return res.status(200).json({ leaderboard: getThemeLeaderboard(order) });
  }

  // ── Sustained tickers ─────────────────────────────────────────────────────
  if (q.sustained === "1") {
    const minRuns  = parseInt(q.minRuns  ?? "3",  10);
    const lookback = parseInt(q.lookback ?? "10", 10);
    return res.status(200).json({ sustained: getSustainedTickers(minRuns, lookback) });
  }

  // ── Pipeline runs ─────────────────────────────────────────────────────────
  if (q.runs === "1") {
    if (q.from && q.to) {
      const runs = getRunsInRange(parseInt(q.from), parseInt(q.to));
      return res.status(200).json({ runs, count: runs.length });
    }
    const limit = Math.min(parseInt(q.limit ?? "20", 10), 200);
    const runs  = getPipelineRuns(limit);
    return res.status(200).json({ runs, count: runs.length });
  }

  return res.status(400).json({
    error: "Unknown query. See endpoint docs.",
    endpoints: [
      "/api/pipeline/history",
      "/api/pipeline/history?ticker=NVDA",
      "/api/pipeline/history?ticker=NVDA&evals=1",
      "/api/pipeline/history?theme=AI",
      "/api/pipeline/history?themes=1",
      "/api/pipeline/history?leaderboard=1",
      "/api/pipeline/history?sustained=1",
      "/api/pipeline/history?runs=1",
    ],
  });
}
