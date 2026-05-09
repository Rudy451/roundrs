// /pages/api/pipeline/feedback.js
//
// GET  /api/pipeline/feedback           → latest learning record
// GET  /api/pipeline/feedback?all=1     → last 20 learning records
// GET  /api/pipeline/feedback?format=1  → human-readable recommendation text
// POST /api/pipeline/feedback           → trigger a feedback cycle

import {
  runFeedbackCycle,
  getLearningRecords,
  getLatestLearningRecord,
  formatRecommendations,
} from "@/lib/pipeline/feedback";

export default async function handler(req, res) {

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {

    // Human-readable format
    if (req.query.format === "1") {
      return res.status(200).json({ text: formatRecommendations() });
    }

    // All records
    if (req.query.all === "1") {
      const limit   = Math.min(parseInt(req.query.limit ?? "20", 10), 100);
      const records = getLearningRecords(limit);
      return res.status(200).json({ records, count: records.length });
    }

    // Latest record
    const latest = getLatestLearningRecord();
    if (!latest) {
      return res.status(404).json({ error: "No learning records yet. POST to trigger a cycle." });
    }
    return res.status(200).json({ record: latest });
  }

  // ── POST — trigger feedback cycle ─────────────────────────────────────────
  if (req.method === "POST") {
    const record = runFeedbackCycle();
    return res.status(200).json({ record });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
