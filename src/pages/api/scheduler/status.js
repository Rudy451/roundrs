// /pages/api/scheduler/status.js
//
// Returns current scheduler state + run log.
// Polled by the Scheduler Monitor UI every 5 seconds.
//
// GET /api/scheduler/status          → full status + recent log
// GET /api/scheduler/status?log=5    → limit log to 5 entries
// POST /api/scheduler/status         → trigger an immediate run

import { getSchedulerStatus }  from "@/lib/scheduler/scheduler";
import { getRunLog, getRunStats } from "@/lib/scheduler/schedulerState";
import { triggerNow }           from "@/lib/scheduler/scheduler";

export default async function handler(req, res) {

  if (req.method === "GET") {
    const logLimit = parseInt(req.query.log || "20", 10);

    return res.status(200).json({
      scheduler: getSchedulerStatus(),
      stats:     getRunStats(),
      log:       getRunLog(logLimit),
      servedAt:  Date.now(),
    });
  }

  if (req.method === "POST") {
    // Manual trigger — fire and don't wait (returns immediately)
    triggerNow().catch(e => console.error("[scheduler/status] Manual trigger failed:", e));
    return res.status(202).json({ triggered: true, message: "Pipeline run queued" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
