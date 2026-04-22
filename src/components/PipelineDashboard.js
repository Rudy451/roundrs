"use client";
// components/PipelineDashboard.jsx
// Automated pipeline: Reddit -> normalize -> extract -> aggregate -> Claude rank.

import { useState } from "react";
import { C, S, SIGNAL_TYPE, VELOCITY, scoreColor } from "../lib/ui/tokens";

const SUBREDDITS = ["wallstreetbets", "stocks", "investing"];
const BLOCKLIST = new Set(["A","AN","THE","AND","OR","BUT","FOR","AT","BY","IN","OF","ON","TO","UP","AS","IT","IS","BE","DO","GO","NO","IF","MY","WE","HE","ME","US","OK","AM","PM","VS","ALL","ARE","NEW","NOW","BUY","SELL","GET","HAS","LOW","HIGH","YES","NOT","TOP","HOT","CEO","CFO","IPO","ATH","ETF","NAV","GDP","CPI","FED","SEC","WHO","LOL","IMO","FOMO","YOLO","MOON","BEAR","BULL","PUMP","DUMP","WHEN","THEN","THIS","THAT","WHAT","WITH","FROM","HAVE","WILL","MORE","LIKE","JUST","GOOD","BEEN","SAID","YOUR","WANT","MAKE","MOVE","DOWN","NEXT","SOME","INTO","OVER","BACK","MUCH","MOST","TAKE","LONG","KEEP","YEAR","WEEK","DEBT","RATE","RISK","CASH","LOST","EASY","HARD","KNOW","NEWS","HOLD","SOLD","NEED","TIME","GAIN","LOSS","FUND","BANK","OPEN","ONCE","PAST","PLAN","AI","EV","UK","EU"]);
const KNOWN = new Set(["AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","META","TSLA","AVGO","LLY","V","JPM","XOM","MA","JNJ","AMD","INTC","QCOM","ORCL","CRM","ADBE","NOW","SNOW","PLTR","UBER","SHOP","SQ","PYPL","COIN","HOOD","RBLX","DDOG","CRWD","ZS","NET","MDB","BAC","GS","MS","WFC","C","BLK","SCHW","MRNA","PFE","ABBV","BMY","GILD","VRTX","ISRG","CELH","CVX","COP","SLB","EOG","MPC","OXY","GUSH","USO","XLE","WMT","COST","TGT","HD","LOW","MCD","SBUX","NKE","TSM","ASML","AMAT","MU","MRVL","SMCI","ARM","RIVN","LCID","NIO","SPY","QQQ","IWM","DIA","VTI","TLT","IEF","GLD","SLV","GDX","XLK","XLF","ARKK","URA","CCJ","SOXL","GME","AMC","MSTR","SOFI","DKNG","MGM","F","GM","FSLR","ENPH","IBB","XBI","ZROZ","IBIT","FBTC"]);

async function fetchSub(sub) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=50&raw_json=1`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.children || []).map((child) => ({
      id: child.data.id,
      subreddit: sub,
      title: child.data.title || "",
      body: child.data.selftext || "",
      score: child.data.score || 0,
      created_utc: child.data.created_utc || 0,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalize(post) {
  let text = `${post.title} ${post.body}`;
  text = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\$([A-Z]{1,5})\b/g, " $1 ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return text;
}

function extract(text) {
  return [...new Set((text.match(/\b([A-Z]{2,5})\b/g) || []).filter((match) => !BLOCKLIST.has(match) && KNOWN.has(match)))];
}

function aggregate(extracted, topN = 15) {
  const map = {};
  for (const { post, tickers } of extracted) {
    for (const ticker of tickers) {
      if (!map[ticker]) map[ticker] = { mentions: 0, posts: [] };
      map[ticker].mentions++;
      map[ticker].posts.push(post);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  return Object.entries(map)
    .map(([ticker, { mentions, posts }]) => {
      const recent = posts.filter((post) => post.created_utc >= now - 7200).length;
      const velocity = recent >= 3 ? "high" : recent >= 1 ? "medium" : "low";
      const avgScore = Math.round(posts.reduce((sum, post) => sum + post.score, 0) / posts.length);
      const sample = [...posts]
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((post) => ({
          title: post.title.slice(0, 120),
          score: post.score,
          subreddit: post.subreddit,
          body: post.body.slice(0, 140),
        }));

      return { ticker, mentions, velocity, avgScore, sample };
    })
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, topN);
}

const RANK_PROMPT = `You are an investment signal ranking engine for DraftBoard. Rank pre-aggregated ticker signals by ATTENTION WORTHINESS.

Score 0-100: signal quality (substance > velocity > novelty). Apply crowding penalty. Return ONLY valid JSON array, no markdown.
[{"ticker":"X","score":0-100,"mentions":N,"velocity":"low|medium|high","signalType":"news|thesis|hype|meme|unknown","confidence":0.0-1.0,"reasoning":"brief","risks":[]}]
Sort by score DESC.`;

async function rankWithClaude(signals) {
  const payload = signals.map((signal) => ({
    ticker: signal.ticker,
    mentions: signal.mentions,
    velocity: signal.velocity,
    avgPostScore: signal.avgScore,
    sampleText: signal.sample.map((post) => `[r/${post.subreddit} ^${post.score}] ${post.title}. ${post.body}`).join(" | "),
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: RANK_PROMPT,
      messages: [{ role: "user", content: `Rank these ${signals.length} signals:\n\n${JSON.stringify(payload, null, 2)}` }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

  const raw = data.content.map((block) => block.text || "").join("");
  const match = raw.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array");

  return JSON.parse(match[0]);
}

const MOCK = [
  { ticker: "SMCI", mentions: 7, velocity: "high", avgScore: 920, sample: [{ title: "SMCI massively undervalued - AI server exposure nobody talking about", score: 1240, subreddit: "wallstreetbets", body: "Liquid cooling partnership with NVDA. Revenue guidance $14-15B. Completely overlooked." }] },
  { ticker: "NVDA", mentions: 14, velocity: "medium", avgScore: 2100, sample: [{ title: "NVDA calls are printing", score: 2890, subreddit: "wallstreetbets", body: "NVDA never goes down. Loading 200c for next week." }] },
  { ticker: "CCJ", mentions: 5, velocity: "high", avgScore: 567, sample: [{ title: "CCJ uranium thesis - 10yr supply deal signed", score: 567, subreddit: "stocks", body: "Nuclear renaissance is real. Cameco has pricing power as utilities scramble." }] },
  { ticker: "PLTR", mentions: 6, velocity: "high", avgScore: 891, sample: [{ title: "PLTR earnings - government contracts expanding", score: 891, subreddit: "wallstreetbets", body: "DoD contracts, AIP is real. Commercial growing 55% YoY." }] },
  { ticker: "TLT", mentions: 3, velocity: "medium", avgScore: 312, sample: [{ title: "TLT and IEF for the rate cut trade", score: 312, subreddit: "investing", body: "10yr at 5% is unsustainable. ZROZ for maximum duration leverage." }] },
  { ticker: "GME", mentions: 11, velocity: "high", avgScore: 2890, sample: [{ title: "GME Roaring Kitty is back", score: 3200, subreddit: "wallstreetbets", body: "YOLO GME calls. Diamond hands. To the moon." }] },
];

function StageRow({ label, status, detail }) {
  const color = status === "done" ? C.green : status === "active" ? C.amber : status === "error" ? C.red : C.textDisabled;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.border0}` }}>
      <div className="pip" style={{ background: color, animation: status === "active" ? "livePip 1s ease infinite" : "none" }} />
      <span className="t-mono" style={{ flex: 1, color: status === "idle" ? C.textDisabled : C.textSecondary }}>{label}</span>
      {detail && <span className="t-mono t-disabled">{detail}</span>}
    </div>
  );
}

function RankedCard({ result, rank }) {
  const [open, setOpen] = useState(false);
  const signalMeta = SIGNAL_TYPE[result.signalType] || SIGNAL_TYPE.unknown;
  const velocityMeta = VELOCITY[result.velocity] || VELOCITY.low;
  const score = scoreColor(result.score);

  return (
    <div className="card card-p2 animate-card" style={{ cursor: "pointer", animationDelay: `${rank * 40}ms` }} onClick={() => setOpen((value) => !value)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="t-label" style={{ width: 20, flexShrink: 0 }}>#{rank}</span>
        <span style={S.ticker}>{result.ticker}</span>
        <span className={`badge ${signalMeta.badgeClass}`}>{signalMeta.label}</span>
        <span className={`t-mono ${velocityMeta.colorClass}`}>{velocityMeta.label}</span>
        <span className="t-label" style={{ marginLeft: "auto" }}>{result.mentions}x</span>
        <span className="t-mono" style={{ color: score, width: 28, textAlign: "right" }}>{result.score}</span>
      </div>

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border0}` }}>
          <div className="bar-track" style={{ marginBottom: 8 }}>
            <div className="bar-fill bar-green" style={{ width: `${result.score}%` }} />
          </div>
          <p className="t-body">{result.reasoning}</p>
          {result.risks?.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
              {result.risks.map((risk, index) => <span key={index} className="badge badge-red">! {risk}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PipelineDashboard() {
  const [stages, setStages] = useState({ ingest: "idle", normalize: "idle", extract: "idle", aggregate: "idle", rank: "idle" });
  const [stageMeta, setStageMeta] = useState({});
  const [candidates, setCandidates] = useState([]);
  const [ranked, setRanked] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [useLive, setUseLive] = useState(true);

  function setStage(key, value) {
    setStages((state) => ({ ...state, [key]: value }));
  }

  function setMeta(key, value) {
    setStageMeta((state) => ({ ...state, [key]: value }));
  }

  async function run() {
    setPhase("running");
    setRanked([]);
    setCandidates([]);
    setError("");
    setStages({ ingest: "idle", normalize: "idle", extract: "idle", aggregate: "idle", rank: "idle" });
    setStageMeta({});

    try {
      setStage("ingest", "active");
      let posts = [];

      if (useLive) {
        const fetched = await Promise.allSettled(SUBREDDITS.map((sub) => fetchSub(sub)));
        fetched.forEach((result) => {
          if (result.status === "fulfilled") posts.push(...result.value);
        });

        const seen = new Set();
        posts = posts.filter((post) => {
          if (seen.has(post.id)) return false;
          seen.add(post.id);
          return true;
        });
      } else {
        posts = MOCK.flatMap((signal) => signal.sample.map((post, index) => ({
          id: `m_${signal.ticker}_${index}`,
          subreddit: post.subreddit,
          title: post.title,
          body: post.body,
          score: post.score,
          created_utc: Math.floor(Date.now() / 1000) - 1200,
        })));
      }

      if (posts.length === 0) throw new Error("No posts fetched - Reddit may be rate-limiting. Try mock mode.");
      setStage("ingest", "done");
      setMeta("ingest", `${posts.length} posts`);

      setStage("normalize", "active");
      await new Promise((resolve) => setTimeout(resolve, 180));
      const normalized = posts.map((post) => ({ post, text: normalize(post) }));
      setStage("normalize", "done");
      setMeta("normalize", `${normalized.length} docs`);

      setStage("extract", "active");
      await new Promise((resolve) => setTimeout(resolve, 180));
      const extracted = normalized.map(({ post, text }) => ({ post, tickers: extract(text) }));
      const unique = new Set(extracted.flatMap((entry) => entry.tickers));
      setStage("extract", "done");
      setMeta("extract", `${unique.size} tickers`);

      setStage("aggregate", "active");
      await new Promise((resolve) => setTimeout(resolve, 180));
      const aggregated = useLive ? aggregate(extracted, 15) : MOCK;
      setCandidates(aggregated);
      setStage("aggregate", "done");
      setMeta("aggregate", `${aggregated.length} candidates`);

      setStage("rank", "active");
      const rankedResult = await rankWithClaude(aggregated);
      setRanked(rankedResult.sort((a, b) => b.score - a.score));
      setStage("rank", "done");
      setMeta("rank", `${rankedResult.length} ranked`);
      setPhase("done");
    } catch (e) {
      setError(e.message);
      setPhase("error");
      setStages((state) => {
        const next = { ...state };
        for (const key in next) {
          if (next[key] === "active") next[key] = "error";
        }
        return next;
      });
    }
  }

  return (
    <div style={{ padding: "var(--sp-6)", display: "grid", gridTemplateColumns: "220px 1fr", gap: "var(--sp-5)", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <div className="card-inset" style={{ padding: "var(--sp-4)" }}>
          <div className="section-head">Control</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-3)" }}>
            <span className="t-label">Source</span>
            <button className={`btn ${useLive ? "btn-primary" : ""}`} onClick={() => setUseLive((value) => !value)} disabled={phase === "running"}>
              {useLive ? "Live" : "Mock"}
            </button>
          </div>
          <button className={`btn ${phase !== "running" ? "btn-primary" : ""}`} style={{ width: "100%", justifyContent: "center" }} onClick={run} disabled={phase === "running"}>
            {phase === "running" ? <><span className="spinner" /> Running...</> : phase === "done" ? "Run again" : "Run pipeline"}
          </button>
        </div>

        <div className="card-inset" style={{ padding: "var(--sp-4)" }}>
          <div className="section-head">Stages</div>
          {[["ingest", "1. Ingest"], ["normalize", "2. Normalize"], ["extract", "3. Extract"], ["aggregate", "4. Aggregate"], ["rank", "5. AI Rank"]].map(([key, label]) => (
            <StageRow key={key} label={label} status={stages[key]} detail={stageMeta[key]} />
          ))}
        </div>
      </div>

      <div>
        {error && <div className="error-block" style={{ marginBottom: "var(--sp-4)" }}>{error}</div>}

        {candidates.length > 0 && ranked.length === 0 && (
          <div className="card-inset" style={{ padding: "var(--sp-4)", marginBottom: "var(--sp-4)" }}>
            <div className="section-head">Candidates - awaiting ranking</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
              {candidates.map((candidate) => (
                <div key={candidate.ticker} className="card-inset" style={{ padding: "4px 10px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={S.ticker}>{candidate.ticker}</span>
                  <span className="t-label">{candidate.mentions}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {ranked.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
              {[["Ranked", ranked.length], ["Top score", ranked[0]?.score], ["Thesis", ranked.filter((result) => result.signalType === "thesis").length]].map(([label, value]) => (
                <div key={label} className="card-inset" style={{ padding: "10px 14px" }}>
                  <div className="t-value" style={{ fontSize: 20 }}>{value}</div>
                  <div className="t-label" style={{ marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>
            {ranked[0] && (
              <div className="card-inset card--green" style={{ padding: "10px 14px", marginBottom: "var(--sp-4)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span className="t-label t-green" style={{ flexShrink: 0, paddingTop: 2 }}>Top</span>
                <span style={{ ...S.ticker, color: C.green }}>{ranked[0].ticker}</span>
                <span className="t-body" style={{ marginLeft: 4 }}>{ranked[0].reasoning}</span>
              </div>
            )}
            <div className="section-head">{ranked.length} candidates ranked - click to expand</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              {ranked.map((result, index) => <RankedCard key={result.ticker + index} result={result} rank={index + 1} />)}
            </div>
          </>
        )}

        {phase === "idle" && <div className="empty-state">Press run to begin</div>}
      </div>
    </div>
  );
}
