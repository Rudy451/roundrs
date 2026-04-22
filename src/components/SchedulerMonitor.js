"use client";
// components/SchedulerMonitor.jsx
// Live cron scheduler monitor. Simulates a running scheduler in-browser.
// In production: poll /api/scheduler/status every 5s and replace mock state.

import { useState, useEffect, useRef, useCallback } from "react";
import { C, S } from "../lib/ui/tokens";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Simulated scheduler (mirrors real backend) ───────────────────────────────

function buildInitialLog(count = 8) {
  const now  = Date.now();
  const log  = [];
  for (let i = 0; i < count; i++) {
    const startedAt  = now - i * INTERVAL_MS - Math.random() * 3000;
    const success    = Math.random() > 0.12;
    const durationMs = 3200 + Math.random() * 7500;
    log.push({
      runId:          `run_${Math.floor(startedAt)}`,
      status:         success ? "success" : "error",
      timestamp:      startedAt + durationMs,
      startedAt,
      durationMs:     success ? Math.round(durationMs) : Math.round(durationMs * 0.28),
      postsProcessed: success ? Math.floor(120 + Math.random() * 80) : 0,
      tickersFound:   success ? Math.floor(14 + Math.random() * 14) : 0,
      candidates:     success ? Math.floor(8  + Math.random() * 9)  : 0,
      topTicker:      success ? ["SMCI","NVDA","CCJ","PLTR","AMD","CELH","MSTR"][Math.floor(Math.random() * 7)] : null,
      topScore:       success ? Math.floor(60 + Math.random() * 35) : null,
      error:          success ? null : ["Reddit rate limit","Fetch timeout","JSON parse error"][Math.floor(Math.random() * 3)],
    });
  }
  return log;
}

function useScheduler() {
  const [log,      setLog]      = useState(() => buildInitialLog(8));
  const [running,  setRunning]  = useState(false);
  const [active,   setActive]   = useState(true);
  const [msToNext, setMsToNext] = useState(INTERVAL_MS);
  const nextRef = useRef(Date.now() + INTERVAL_MS);

  const executeRun = useCallback(async () => {
    if (running || !active) return;
    setRunning(true);
    const startedAt  = Date.now();
    const runId      = `run_${startedAt}`;
    const durationMs = 3000 + Math.random() * 7000;
    await new Promise(r => setTimeout(r, Math.min(durationMs, 3500)));
    const success = Math.random() > 0.1;
    setLog(prev => [{
      runId, status: success ? "success" : "error",
      timestamp: Date.now(), startedAt,
      durationMs:     Math.round(durationMs),
      postsProcessed: success ? Math.floor(125 + Math.random() * 75) : 0,
      tickersFound:   success ? Math.floor(15 + Math.random() * 14)  : 0,
      candidates:     success ? Math.floor(9 + Math.random() * 8)    : 0,
      topTicker:      success ? ["SMCI","CCJ","PLTR","NVDA","AMD","CELH"][Math.floor(Math.random() * 6)] : null,
      topScore:       success ? Math.floor(62 + Math.random() * 30)  : null,
      error:          success ? null : ["Reddit rate limit","Fetch timeout"][Math.floor(Math.random() * 2)],
    }, ...prev].slice(0, 50));
    setRunning(false);
  }, [running, active]);

  useEffect(() => {
    const id = setInterval(() => {
      const now  = Date.now();
      const left = nextRef.current - now;
      if (left <= 0 && active && !running) {
        nextRef.current = now + INTERVAL_MS;
        executeRun();
      }
      setMsToNext(Math.max(0, nextRef.current - Date.now()));
    }, 500);
    return () => clearInterval(id);
  }, [active, running, executeRun]);

  function triggerNow() {
    nextRef.current = Date.now() + INTERVAL_MS;
    executeRun();
  }

  function toggleActive() { setActive(a => !a); }

  const stats = {
    total:       log.length,
    successRate: log.length ? Math.round(log.filter(e => e.status === "success").length / log.length * 100) : 0,
    avgDuration: (() => { const s = log.filter(e => e.status === "success"); return s.length ? Math.round(s.reduce((a, e) => a + e.durationMs, 0) / s.length) : 0; })(),
    avgCand:     (() => { const s = log.filter(e => e.status === "success"); return s.length ? Math.round(s.reduce((a, e) => a + e.candidates, 0) / s.length) : 0; })(),
  };

  return { log, running, active, msToNext, stats, triggerNow, toggleActive };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDur(ms) {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtRelative(ts) {
  if (!ts) return "—";
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60)   return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

function fmtCountdown(ms) {
  const s   = Math.floor(ms / 1000);
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CountdownRing({ ms, totalMs }) {
  const pct  = 1 - (ms / totalMs);
  const r    = 28; const cx = 34; const cy = 34; const stroke = 3;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 68, height: 68, flexShrink: 0 }}>
      <svg width="68" height="68" style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.border1} strokeWidth={stroke} />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={C.amber} strokeWidth={stroke}
          strokeDasharray={`${pct * circ} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.5s linear" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: C.fontData, fontSize: 12, color: C.amber }}>{fmtCountdown(ms)}</span>
        <span className="t-label" style={{ fontSize: 8 }}>next</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="card-inset" style={{ padding: "10px 14px" }}>
      <div className="t-value" style={{ fontSize: 20, color: color || C.textPrimary }}>{value}</div>
      <div className="t-label" style={{ marginTop: 3 }}>{label}</div>
    </div>
  );
}

function LogRow({ entry, isNew }) {
  const ok  = entry.status === "success";
  return (
    <tr className={isNew ? "animate-row" : ""}>
      <td><span className="pip" style={{ background: ok ? C.green : C.red, display: "inline-block" }} /></td>
      <td className="t-mono" style={{ color: C.textTertiary }}>{fmtTime(entry.startedAt)}</td>
      <td className={ok ? "td-green" : "td-red"}>{ok ? "ok" : "err"}</td>
      <td>{fmtDur(entry.durationMs)}</td>
      <td className={ok ? "td-secondary" : ""}>{ok ? entry.postsProcessed : "—"}</td>
      <td className={ok ? "td-secondary" : ""}>{ok ? entry.candidates : "—"}</td>
      <td className={ok ? "td-amber" : "td-red"} style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ok ? (entry.topTicker ? `${entry.topTicker} · ${entry.topScore}` : "—") : entry.error}
      </td>
    </tr>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SchedulerMonitor() {
  const { log, running, active, msToNext, stats, triggerNow, toggleActive } = useScheduler();

  const lastOk   = log.find(e => e.status === "success");
  const pipColor = running ? C.amber : active ? C.green : C.textDisabled;

  return (
    <div style={{ padding: "var(--sp-6)", maxWidth: 760 }}>

      {/* Header row: status + countdown */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", marginBottom: "var(--sp-5)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
            <div className="pip animate-live" style={{ background: pipColor }} />
            <span className="t-label" style={{ color: active ? C.textSecondary : C.textDisabled }}>
              {running ? "Running pipeline…" : active ? "Scheduler active" : "Scheduler paused"}
            </span>
          </div>
          <div className="t-label" style={{ letterSpacing: "0.1em" }}>*/30 * * * *</div>
        </div>

        <CountdownRing ms={msToNext} totalMs={INTERVAL_MS} />
      </div>

      {/* Running banner */}
      {running && (
        <div
          className="card-inset"
          style={{ padding: "10px 14px", marginBottom: "var(--sp-4)", display: "flex", alignItems: "center", gap: "var(--sp-3)", borderColor: C.amberBorder }}
        >
          <span className="spinner" />
          <span className="t-mono" style={{ color: C.amber, fontSize: 11 }}>
            Ingesting Reddit · normalizing · extracting · ranking with Claude…
          </span>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
        <StatCard label="Total runs"    value={stats.total}        />
        <StatCard label="Success rate"  value={`${stats.successRate}%`} color={C.green} />
        <StatCard label="Avg duration"  value={fmtDur(stats.avgDuration)} />
        <StatCard label="Avg candidates" value={stats.avgCand}    />
      </div>

      {/* Last run snapshot */}
      {lastOk && (
        <div
          className="card-inset"
          style={{ padding: "12px 16px", marginBottom: "var(--sp-4)", display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 0 }}
        >
          {[
            ["Last run",   fmtTime(lastOk.startedAt), C.textTertiary],
            ["Posts",      lastOk.postsProcessed,     C.textPrimary],
            ["Tickers",    lastOk.tickersFound,        C.textPrimary],
            ["Candidates", lastOk.candidates,          C.green],
            ["Top signal", lastOk.topTicker ? `${lastOk.topTicker} · ${lastOk.topScore}` : "—", C.amber],
          ].map(([label, val, color], i) => (
            <div key={label} style={{ paddingRight: 16, borderRight: i < 4 ? `1px solid ${C.border0}` : "none", paddingLeft: i > 0 ? 16 : 0 }}>
              <div className="t-label" style={{ marginBottom: 4 }}>{label}</div>
              <div className="t-mono" style={{ color }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        <button
          className={`btn ${!running ? "btn-primary" : ""}`}
          onClick={triggerNow}
          disabled={running}
        >
          {running ? <><span className="spinner" /> Running…</> : "▶ Run now"}
        </button>

        <button
          className={`btn ${!active ? "btn-primary" : "btn-danger"}`}
          onClick={toggleActive}
        >
          {active ? "Pause scheduler" : "Resume scheduler"}
        </button>

        <div
          className="card-inset"
          style={{ padding: "6px 12px", marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}
        >
          <div className="pip animate-live" style={{ background: C.amber }} />
          <span className="t-label">30 min interval</span>
        </div>
      </div>

      {/* Run log table */}
      <div className="section-head">Run log</div>
      <div className="card-inset" style={{ overflow: "hidden" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 14 }}></th>
              <th>Time</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Posts</th>
              <th>Candidates</th>
              <th>Top signal</th>
            </tr>
          </thead>
          <tbody>
            {log.slice(0, 20).map((entry, i) => (
              <LogRow key={entry.runId} entry={entry} isNew={i === 0} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Deploy info */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)", marginTop: "var(--sp-4)" }}>
        {[
          ["Node.js server", `import { startScheduler } from "@/lib/scheduler/scheduler";\nstartScheduler(); // in server.js`],
          ["Vercel serverless", `// vercel.json\n{ "crons": [{ "path": "/api/cron/pipeline", "schedule": "*/30 * * * *" }] }`],
        ].map(([label, code]) => (
          <div key={label} className="card-inset" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
            <div className="t-label" style={{ marginBottom: "var(--sp-2)" }}>{label}</div>
            <pre style={{ fontFamily: C.fontData, fontSize: 10, color: C.textDisabled, margin: 0, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{code}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
