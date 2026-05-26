"use client";

import { useState } from "react";

import DraftBoard        from "../components/DraftBoard";
import DiscoveryEngine   from "../components/DiscoveryEngine";
import PipelineDashboard from "../components/PipelineDashboard";
import ThemeIntelligence from "../components/ThemeIntelligence";
import ThemeWorkbench    from "../components/ThemeWorkbench";
import SchedulerMonitor  from "../components/SchedulerMonitor";

const NAV = [
  {
    group: "Market",
    items: [
      { id: "market",       label: "Live signals"               },
    ],
  },
  {
    group: "Discovery",
    items: [
      { id: "discovery",    label: "Discovery"                  },
      { id: "pipeline",     label: "Pipeline",  badge: "AUTO"   },
    ],
  },
  {
    group: "Themes",
    items: [
      { id: "intelligence", label: "Intelligence"               },
      { id: "workbench",    label: "Workbench"                  },
    ],
  },
  {
    group: "Automation",
    items: [
      { id: "scheduler",    label: "Scheduler"                  },
    ],
  },
];

// Descriptions updated per audit recommendation:
// DraftBoard surfaces what Reddit is discussing in investment terms, scored and
// filtered for quality. It is a structured feed of retail discussion activity,
// not a novel signal discovery engine. Descriptions reflect this accurately.
const VIEW_META = {
  market:       {
    title: "Live signals",
    desc:  "Scored Reddit discussion activity — top-mentioned tickers by attention quality",
  },
  discovery:    {
    title: "Discovery",
    desc:  "Extract and rank signals from Reddit text · surfaces what is being discussed, not undiscovered ideas",
  },
  pipeline:     {
    title: "Pipeline",
    desc:  "Automated ingestion, scoring, and filtering of retail investment discussion",
  },
  intelligence: {
    title: "Theme intelligence",
    desc:  "Score investment themes by discussion density and ticker mappability",
  },
  workbench:    {
    title: "Theme workbench",
    desc:  "Expand themes into targeted Reddit search queries",
  },
  scheduler:    {
    title: "Scheduler",
    desc:  "Automated 30-minute pipeline runs",
  },
};

export default function Home() {
  const [activeView,  setActiveView]  = useState("market");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const meta = VIEW_META[activeView];

  return (
    <div className="db-shell">

      {/* Header */}
      <header className="db-header">
        <button
          className="db-toggle"
          onClick={() => setSidebarOpen(o => !o)}
          aria-label="Toggle navigation"
        >
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
            <rect y="0"  width="16" height="1.5" rx="0.75" fill="currentColor" />
            <rect y="5"  width="11" height="1.5" rx="0.75" fill="currentColor" />
            <rect y="10" width="16" height="1.5" rx="0.75" fill="currentColor" />
          </svg>
        </button>

        <span className="db-wordmark">The Peanut Gallery</span>

        <div className="db-header-rule" />

        <span className="db-header-crumb">{meta.title}</span>

        <div className="db-header-status">
          <div className="pip pip-green animate-live" style={{ display: "inline-block" }} />
          pipeline active
        </div>
      </header>

      {/* Body */}
      <div className="db-body">

        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="db-sidebar">
            {NAV.map(group => (
              <div key={group.group} className="db-nav-group">
                <div className="db-nav-group-label">{group.group}</div>
                {group.items.map(item => (
                  <button
                    key={item.id}
                    className={`db-nav-item${activeView === item.id ? " active" : ""}`}
                    onClick={() => setActiveView(item.id)}
                  >
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.badge && (
                      <span className="db-nav-badge">{item.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}

            <div className="db-sidebar-footer">
              <div className="t-label">
                {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
              <div className="t-label" style={{ marginTop: 3 }}>next run 14:32</div>
            </div>
          </aside>
        )}

        {/* Main */}
        <main className="db-main">
          <div className="db-topbar">
            <span className="db-topbar-title">{meta.title}</span>
            <div className="db-topbar-rule" />
            <span className="db-topbar-desc">{meta.desc}</span>
          </div>

          <div className="db-view" key={activeView}>
            {activeView === "market"       && <DraftBoard />}
            {activeView === "discovery"    && <DiscoveryEngine />}
            {activeView === "pipeline"     && <PipelineDashboard />}
            {activeView === "intelligence" && <ThemeIntelligence />}
            {activeView === "workbench"    && <ThemeWorkbench />}
            {activeView === "scheduler"    && <SchedulerMonitor />}
          </div>
        </main>

      </div>
    </div>
  );
}
