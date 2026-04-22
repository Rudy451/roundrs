// /pages/api/pipeline/run.js
// Thin API route — triggers the pipeline and returns ranked candidates.
// GET  /api/pipeline/run           → live Reddit run
// GET  /api/pipeline/run?dry=true  → mock data run (for dev/testing)

import { runPipeline } from "@/lib/pipeline/runner";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const dryRun = req.query.dry === "true";
  const topN = parseInt(req.query.topN || "20", 10);

  try {
    const result = await runPipeline({ topN, dryRun, validateTickers: true });
    return res.status(200).json(result);
  } catch (e) {
    console.error("[api/pipeline/run]", e);
    return res.status(500).json({ error: e.message });
  }
}
