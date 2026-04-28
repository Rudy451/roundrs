// /pages/api/pipeline/run.js
//
// Triggers the discovery pipeline and returns results.
//
// GET  /api/pipeline/run              → live Reddit run, 20 results
// GET  /api/pipeline/run?dry=true     → mock data, no network (dev/testing)
// GET  /api/pipeline/run?topN=10      → limit candidates returned
//
// Response shape matches PipelineResult from runner.js.

import { runDiscoveryPipeline } from "@/lib/pipeline/runner";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const dryRun = req.query.dry === "true";
  const topN   = Math.min(parseInt(req.query.topN || "20", 10), 50);

  const result = await runDiscoveryPipeline({ topN, dryRun });

  if (!result.success) {
    return res.status(500).json({
      success: false,
      error:   result.error,
      summary: result.summary,
    });
  }

  return res.status(200).json(result);
}
