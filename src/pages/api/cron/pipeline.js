// /pages/api/cron/pipeline.js
//
// Vercel Cron Job endpoint.
// Vercel calls this route on the schedule defined in vercel.json.
// Protected by CRON_SECRET env variable — never expose without auth.
//
// vercel.json (add to project root):
// {
//   "crons": [{
//     "path": "/api/cron/pipeline",
//     "schedule": "*/30 * * * *"
//   }]
// }
//
// Environment variables required:
//   CRON_SECRET=<your-secret-string>   (set in Vercel dashboard)

import { runPipeline }     from "@/lib/pipeline/runner";
import { appendRunLog,
         setSchedulerState,
         getSchedulerState } from "@/lib/scheduler/schedulerState";

export default async function handler(req, res) {
  // ── Auth: reject unauthorized callers ──────────────────────────────────────
  // Vercel passes the secret via Authorization header in production.
  // Skip auth check in local dev for convenience.
  if (process.env.NODE_ENV === "production") {
    const authHeader = req.headers.authorization;
    const expected   = `Bearer ${process.env.CRON_SECRET}`;
    if (!authHeader || authHeader !== expected) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Idempotency guard ──────────────────────────────────────────────────────
  const state = getSchedulerState();
  if (state.isRunning) {
    return res.status(200).json({
      status:  "skipped",
      reason:  "previous run still in progress",
      runId:   state.lastRunId,
    });
  }

  // ── Run the pipeline ───────────────────────────────────────────────────────
  const runId     = `cron_${Date.now()}`;
  const startedAt = Date.now();

  setSchedulerState({ isRunning: true, lastRunId: runId, lastRunStartedAt: startedAt });

  try {
    const result = await runPipeline({
      topN:            20,
      validateTickers: true,
      dryRun:          false,
    });

    const log = {
      runId,
      status:         "success",
      timestamp:      Date.now(),
      startedAt,
      durationMs:     result.summary.durationMs,
      postsProcessed: result.summary.postsIngested,
      tickersFound:   result.summary.uniqueTickers,
      candidates:     result.summary.candidates,
      topTicker:      result.summary.topTicker,
      topScore:       result.summary.topScore,
      source:         "vercel-cron",
    };

    appendRunLog(log);
    setSchedulerState({
      isRunning:         false,
      lastSuccessAt:     Date.now(),
      lastResult:        result,
      consecutiveErrors: 0,
    });

    return res.status(200).json({
      success:    true,
      runId,
      durationMs: result.summary.durationMs,
      summary: {
        postsProcessed: result.summary.postsIngested,
        tickersFound:   result.summary.uniqueTickers,
        candidates:     result.summary.candidates,
        topTicker:      result.summary.topTicker,
        topScore:       result.summary.topScore,
      },
    });

  } catch (err) {
    const prevErrors = (getSchedulerState().consecutiveErrors || 0) + 1;

    appendRunLog({
      runId,
      status:            "error",
      timestamp:         Date.now(),
      startedAt,
      durationMs:        Date.now() - startedAt,
      error:             err.message,
      consecutiveErrors: prevErrors,
      source:            "vercel-cron",
    });

    setSchedulerState({
      isRunning:         false,
      lastErrorAt:       Date.now(),
      lastError:         err.message,
      consecutiveErrors: prevErrors,
    });

    console.error("[cron/pipeline] Run failed:", err);
    return res.status(500).json({ success: false, runId, error: err.message });
  }
}

// Vercel: disable default body parsing (not needed for cron)
export const config = { api: { bodyParser: false } };
