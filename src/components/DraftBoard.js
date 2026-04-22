"use client";

import { useEffect, useMemo, useState } from "react";
import { C } from "../lib/ui/tokens";

const DEFAULT_TICKERS = ["NVDA", "MSFT", "SPY", "GUSH", "AAPL", "TSLA"];
const POLL_MS = 60000;

function formatPrice(value) {
  if (value == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  const num = Number(value || 0);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}

function changeTone(value) {
  if (value > 0) return "t-green";
  if (value < 0) return "t-red";
  return "t-disabled";
}

function attentionTone(value) {
  if (value >= 5) return "badge-green";
  if (value >= 2) return "badge-amber";
  return "badge-neutral";
}

export default function DraftBoard({ tickers = DEFAULT_TICKERS }) {
  const [signals, setSignals] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState(null);

  const tickerQuery = useMemo(() => tickers.join(","), [tickers]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus((prev) => (prev === "idle" ? "loading" : "refreshing"));
      setError("");

      try {
        const res = await fetch(`/api/data?tickers=${encodeURIComponent(tickerQuery)}`, {
          cache: "no-store",
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || data.error || `HTTP ${res.status}`);
        }

        if (!cancelled) {
          setSignals(data.signals || []);
          setFetchedAt(data.fetchedAt || Date.now());
          setStatus("done");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Failed to load signals");
          setStatus("error");
        }
      }
    }

    load();
    const id = setInterval(load, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tickerQuery]);

  return (
    <div style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div className="card-inset" style={{ padding: "var(--sp-4)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <div className={`pip ${status === "error" ? "pip-red" : status === "loading" || status === "refreshing" ? "pip-amber animate-live" : "pip-green"}`} />
        <span className="t-label">
          {status === "loading" ? "Loading signals" : status === "refreshing" ? "Refreshing" : status === "error" ? "Load failed" : "Live market view"}
        </span>
        <span className="t-mono t-disabled" style={{ marginLeft: "auto" }}>
          {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "No snapshot yet"}
        </span>
      </div>

      {error && <div className="error-block">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--sp-3)" }}>
        {signals.map((signal) => (
          <div key={signal.ticker} className="card card-p2 animate-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="t-ticker">{signal.ticker}</span>
              <span className={`badge ${attentionTone(signal.attention)}`} style={{ marginLeft: "auto" }}>
                {signal.attention} mentions
              </span>
            </div>

            <div className="t-value" style={{ fontSize: 20, marginBottom: 8 }}>
              {formatPrice(signal.price)}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span className="t-label">Change</span>
              <span className={`t-mono ${changeTone(signal.changePercent)}`}>{formatPercent(signal.changePercent)}</span>
            </div>

            <div className="bar-track" style={{ marginBottom: 10 }}>
              <div
                className={`bar-fill ${signal.changePercent > 0 ? "bar-green" : signal.changePercent < 0 ? "bar-red" : "bar-slate"}`}
                style={{ width: `${Math.min(Math.abs(signal.changePercent) * 10, 100)}%` }}
              />
            </div>

            <div className="t-mono t-disabled" style={{ fontSize: 10 }}>
              Price {signal.priceTimestamp ? "live" : "unavailable"} | Reddit {signal.attentionTimestamp ? "live" : "fallback"}
            </div>
          </div>
        ))}
      </div>

      {status === "loading" && signals.length === 0 && <div className="empty-state">Loading live snapshot</div>}
      {status !== "loading" && signals.length === 0 && !error && <div className="empty-state">No signals returned</div>}
    </div>
  );
}
