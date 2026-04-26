// /pages/api/pipeline/searchlog.js
//
// GET /api/pipeline/searchlog          → last 10 search run logs
// GET /api/pipeline/searchlog?limit=N  → last N logs
// GET /api/pipeline/searchlog?latest=1 → most recent log only
// GET /api/pipeline/searchlog?summary=1 → one-line summaries only

import {
  getSearchRunLogs,
  getLatestSearchRunLog,
  summarizeSearchRunLog,
} from "@/lib/pipeline/searchLog";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Latest only
  if (req.query.latest === "1") {
    const log = getLatestSearchRunLog();
    if (!log) return res.status(404).json({ error: "No search logs yet" });
    return res.status(200).json({ log });
  }

  const limit = Math.min(parseInt(req.query.limit || "10", 10), 48);
  const logs  = getSearchRunLogs(limit);

  // Summary mode — just the one-liners
  if (req.query.summary === "1") {
    return res.status(200).json({
      summaries: logs.map(summarizeSearchRunLog),
      count:     logs.length,
    });
  }

  return res.status(200).json({ logs, count: logs.length });
}
