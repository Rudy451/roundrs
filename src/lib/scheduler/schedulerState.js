const DEFAULT_STATE = {
  active: false,
  isRunning: false,
  startedAt: null,
  lastRunId: null,
  lastRunStartedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastResult: null,
  consecutiveErrors: 0,
};

let _state = { ...DEFAULT_STATE };
let _runLog = [];

export function getSchedulerState() {
  return { ..._state };
}

export function setSchedulerState(patch = {}) {
  _state = { ..._state, ...patch };
  return getSchedulerState();
}

export function appendRunLog(entry) {
  _runLog.unshift(entry);
  _runLog = _runLog.slice(0, 100);
  return entry;
}

export function getRunLog(limit = 50) {
  return _runLog.slice(0, limit);
}

/**
 * Get aggregate stats from the run log.
 */
export function getRunStats() {
  if (_runLog.length === 0) return { totalRuns: 0, successRate: 0, avgDurationMs: 0, avgCandidates: 0 };

  const total    = _runLog.length;
  const successes = _runLog.filter(r => r.status === "success");
  const avgDur   = successes.length
    ? Math.round(successes.reduce((s, r) => s + (r.durationMs || 0), 0) / successes.length)
    : 0;
  const avgCand  = successes.length
    ? Math.round(successes.reduce((s, r) => s + (r.candidates || 0), 0) / successes.length)
    : 0;

  return {
    totalRuns:    total,
    successRate:  Math.round((successes.length / total) * 100),
    avgDurationMs: avgDur,
    avgCandidates: avgCand,
  };
}
