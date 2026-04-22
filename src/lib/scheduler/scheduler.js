// /lib/scheduler/scheduler.js
//
// Automated discovery pipeline scheduler.
// Wraps runPipeline() in a cron job — zero logic duplication.
//
// Environment-aware:
//   - Node.js long-running server  → uses node-cron (npm install node-cron)
//   - Next.js / Vercel serverless  → use vercel.json cron + /pages/api/cron/pipeline.js
//
// Install:  npm install node-cron
// Usage:    import "@/lib/scheduler/scheduler";  ← in server entry (e.g. server.js)

import cron from "node-cron";
import { runPipeline } from "@/lib/pipeline/runner";
import { appendRunLog, getSchedulerState, setSchedulerState } from "./schedulerState";

// ─── Config ───────────────────────────────────────────────────────────────────

export const SCHEDULER_CONFIG = {
  // Cron expression: every 30 minutes
  // Change to e.g. "*/15 * * * *" for 15min, "0 * * * *" for hourly
  cronExpression: "*/30 * * * *",
  intervalLabel:  "30 minutes",

  // Pipeline options passed on each run
  pipelineOptions: {
    topN:             20,
    validateTickers:  true,
    dryRun:           false,
  },

  // Max log entries to keep in memory
  maxLogEntries: 100,
};

// ─── State ────────────────────────────────────────────────────────────────────

let cronTask = null;

// ─── Core job ─────────────────────────────────────────────────────────────────

/**
 * The job function executed on each cron tick.
 * Calls ONLY runPipeline() — no duplicated logic.
 * Idempotent: safe to call multiple times concurrently (guards with isRunning flag).
 */
async function runDiscoveryPipeline() {
  const state = getSchedulerState();

  // Guard: skip if a run is already in progress
  if (state.isRunning) {
    console.warn("[scheduler] Skipping tick — previous run still in progress");
    appendRunLog({
      status:    "skipped",
      reason:    "previous run in progress",
      timestamp: Date.now(),
    });
    return;
  }

  const runId    = `run_${Date.now()}`;
  const startedAt = Date.now();

  setSchedulerState({ isRunning: true, lastRunId: runId, lastRunStartedAt: startedAt });
  console.log(`[scheduler] Starting pipeline run ${runId}…`);

  try {
    const result = await runPipeline(SCHEDULER_CONFIG.pipelineOptions);

    const log = {
      runId,
      status:         "success",
      timestamp:      Date.now(),
      startedAt,
      durationMs:     result.meta.durationMs,
      postsProcessed: result.meta.stages?.ingest?.postCount  ?? 0,
      tickersFound:   result.meta.stages?.extract?.uniqueTickers ?? 0,
      candidates:     result.signals.length,
      topTicker:      result.signals[0]?.ticker ?? null,
      topScore:       result.signals[0]?.score  ?? null,
      error:          null,
    };

    appendRunLog(log);
    setSchedulerState({
      isRunning:       false,
      lastSuccessAt:   Date.now(),
      lastResult:      result,
      consecutiveErrors: 0,
    });

    console.log(
      `[scheduler] ✓ Run ${runId} complete — ` +
      `${log.postsProcessed} posts, ${log.tickersFound} tickers, ` +
      `${log.candidates} candidates, top: ${log.topTicker} (${log.topScore}) ` +
      `in ${log.durationMs}ms`
    );

  } catch (err) {
    const state = getSchedulerState();
    const consecutiveErrors = (state.consecutiveErrors || 0) + 1;

    const log = {
      runId,
      status:    "error",
      timestamp: Date.now(),
      startedAt,
      durationMs: Date.now() - startedAt,
      error:     err.message,
      consecutiveErrors,
    };

    appendRunLog(log);
    setSchedulerState({
      isRunning:         false,
      lastErrorAt:       Date.now(),
      lastError:         err.message,
      consecutiveErrors,
    });

    console.error(`[scheduler] ✗ Run ${runId} failed (${consecutiveErrors} consecutive):`, err.message);

    // Back off: if 3+ consecutive errors, temporarily pause scheduler
    if (consecutiveErrors >= 3) {
      console.warn("[scheduler] 3 consecutive errors — pausing for 1 cycle");
    }
  }
}

// ─── Scheduler control ────────────────────────────────────────────────────────

/**
 * Start the cron scheduler.
 * Safe to call multiple times — will not create duplicate jobs.
 */
export function startScheduler() {
  if (cronTask) {
    console.log("[scheduler] Already running — ignoring start()");
    return;
  }

  if (!cron.validate(SCHEDULER_CONFIG.cronExpression)) {
    throw new Error(`[scheduler] Invalid cron expression: ${SCHEDULER_CONFIG.cronExpression}`);
  }

  cronTask = cron.schedule(SCHEDULER_CONFIG.cronExpression, runDiscoveryPipeline, {
    scheduled: true,
    timezone:  "America/New_York", // Market timezone
  });

  setSchedulerState({ active: true, startedAt: Date.now() });
  console.log(`[scheduler] Started — running every ${SCHEDULER_CONFIG.intervalLabel} (${SCHEDULER_CONFIG.cronExpression})`);
}

/**
 * Stop the cron scheduler.
 */
export function stopScheduler() {
  if (!cronTask) return;
  cronTask.stop();
  cronTask = null;
  setSchedulerState({ active: false });
  console.log("[scheduler] Stopped");
}

/**
 * Trigger an immediate run outside the schedule.
 * Useful for manual refresh from the API/UI.
 */
export async function triggerNow() {
  console.log("[scheduler] Manual trigger");
  await runDiscoveryPipeline();
}

/**
 * Get current scheduler status for API/UI consumption.
 */
export function getSchedulerStatus() {
  const state = getSchedulerState();
  return {
    active:             !!cronTask,
    cronExpression:     SCHEDULER_CONFIG.cronExpression,
    intervalLabel:      SCHEDULER_CONFIG.intervalLabel,
    isRunning:          state.isRunning     || false,
    startedAt:          state.startedAt     || null,
    lastSuccessAt:      state.lastSuccessAt || null,
    lastErrorAt:        state.lastErrorAt   || null,
    lastError:          state.lastError     || null,
    consecutiveErrors:  state.consecutiveErrors || 0,
    lastRunId:          state.lastRunId     || null,
    lastResult:         state.lastResult    || null,
  };
}
