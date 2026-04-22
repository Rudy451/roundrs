// /lib/pipeline/themeScorer.js
//
// Theme Intelligence Layer — scores themes by investable attention value.
// Answers: "which themes are worth spending pipeline bandwidth on?"
//
// Two-tier scoring:
//   TIER 1 — Deterministic heuristic (instant, no API, consistent)
//   TIER 2 — AI scoring (Claude, richer rationale, handles novel themes)
//
// Output is sorted by score DESC, filtered to score >= minScore.

// ─── Scoring system prompt ────────────────────────────────────────────────────

const SCORING_SYSTEM_PROMPT = `You are a Theme Intelligence Engine for DraftBoard, an investment decision system.

Score each theme (0–100) by INVESTABLE ATTENTION VALUE — how useful it is for discovering non-obvious, tradable signals in Reddit discussion data.

SCORING DIMENSIONS (apply all five, weight as shown):

1. MARKET IMPACT (30%)
   How directly does this theme move tradeable securities?
   90-100: structural macro (rates, inflation) or mega-cap driver (AI, energy)
   70-89:  sector-wide catalyst (biotech approval cycle, uranium supply)
   50-69:  moderate market linkage (consumer sentiment, housing)
   <50:    weak or speculative linkage

2. CATALYST FREQUENCY (25%)
   How often does this theme generate market-moving events?
   High: earnings cycles + macro releases + geopolitical triggers (rates, oil, AI)
   Medium: periodic catalysts (biotech FDA, uranium contracts)
   Low: slow-moving structural themes

3. DISCUSSION VELOCITY (20%)
   Is attention sustained, rising, or fading?
   High: structurally active (AI, crypto in cycle peaks)
   Medium: steady discussion (banks, energy)
   Low: fading narratives, already-priced trades

4. TICKER MAPPABILITY (15%)
   How cleanly does this theme translate to specific tickers?
   High: clear 1:1 mapping (AI→NVDA/AMD/SMCI, oil→CVX/XOM/USO)
   Medium: ETF-level mapping (housing→ITB/XHB)
   Low: diffuse or speculative mapping

5. CROWDING PENALTY (10% — subtract)
   Is this theme oversaturated in retail discourse?
   Heavy penalty: themes already fully priced in, dominated by meme posts
   Light penalty: themes with noise but real signal underneath
   No penalty: under-discussed, emerging, or contrarian themes

ADDITIONAL RULES:
- Score the theme as it exists TODAY, not historically
- Penalize themes that are "obvious trades" — if everyone knows it, discovery value is low
- Reward themes where Reddit discussion contains EMERGING narratives not yet mainstream
- A theme scoring < 50 is not worth pipeline bandwidth at this time
- Be decisive — use the full 0–100 range, don't cluster everything in the 60s

OUTPUT: Return ONLY a valid JSON array. No markdown, no backticks, no preamble.

[
  {
    "theme": "AI",
    "score": 88,
    "dimensions": {
      "marketImpact": 95,
      "catalystFrequency": 85,
      "discussionVelocity": 90,
      "tickerMappability": 95,
      "crowdingPenalty": 25
    },
    "rationale": "Structural mega-driver with clear ticker mapping and sustained catalyst flow. Crowding penalty applied — NVDA coverage is saturated, but second-derivative plays (SMCI, ARM, ANET) remain under-discussed.",
    "topTickers": ["NVDA", "AMD", "SMCI", "ARM", "ANET"],
    "crowded": false,
    "emerging": false
  }
]`;

// ─── Deterministic heuristic scorer ──────────────────────────────────────────
// Used as instant fallback and pre-filter before AI call.
// Scores based on curated knowledge of theme characteristics.

const HEURISTIC_DB = {
  // [marketImpact, catalystFreq, velocity, mappability, crowdingPenalty, topTickers]
  ai:               [95, 85, 88, 95, 22, ["NVDA","AMD","SMCI","ARM","PLTR"]],
  semiconductor:    [90, 80, 75, 92, 15, ["NVDA","AMD","TSMC","ASML","MU"]],
  "interest rates": [98, 90, 80, 85, 10, ["TLT","IEF","ZROZ","XLF","JPM"]],
  rates:            [98, 90, 80, 85, 10, ["TLT","IEF","ZROZ","XLF","JPM"]],
  inflation:        [92, 85, 72, 78, 12, ["TIP","GLD","XLE","BRK","COST"]],
  oil:              [88, 78, 70, 90, 14, ["CVX","XOM","COP","USO","GUSH"]],
  energy:           [85, 75, 68, 88, 12, ["XLE","CVX","XOM","COP","SLB"]],
  uranium:          [78, 60, 72, 88, 8,  ["CCJ","URA","URNM","NLR","LEU"]],
  crypto:           [82, 80, 85, 85, 28, ["MSTR","COIN","IBIT","HOOD","RIOT"]],
  bitcoin:          [80, 78, 82, 88, 26, ["MSTR","IBIT","FBTC","CLSK","RIOT"]],
  biotech:          [80, 82, 65, 85, 10, ["XBI","IBB","MRNA","VRTX","REGN"]],
  healthcare:       [75, 70, 60, 80, 8,  ["XLV","UNH","LLY","JNJ","ISRG"]],
  "weight loss":    [82, 75, 78, 90, 18, ["LLY","NVO","HIMS","ALT","AMGN"]],
  glp1:             [82, 75, 78, 90, 18, ["LLY","NVO","HIMS","ALT","AMGN"]],
  banks:            [80, 78, 65, 88, 10, ["JPM","BAC","GS","WFC","KRE"]],
  fintech:          [72, 68, 62, 85, 12, ["SQ","PYPL","SOFI","HOOD","AFRM"]],
  macro:            [88, 72, 68, 72, 8,  ["SPY","TLT","GLD","DXY","VIX"]],
  recession:        [85, 65, 60, 75, 10, ["SPY","TLT","GLD","XLP","VIX"]],
  china:            [78, 68, 62, 85, 14, ["BABA","JD","PDD","FXI","KWEB"]],
  ev:               [75, 72, 68, 90, 20, ["TSLA","RIVN","NIO","F","GM"]],
  solar:            [70, 65, 58, 88, 12, ["FSLR","ENPH","SEDG","TAN","ICLN"]],
  renewables:       [68, 62, 55, 82, 10, ["ICLN","TAN","FSLR","NEE","BEP"]],
  gold:             [72, 62, 60, 88, 14, ["GLD","GDX","GDXJ","NEM","AEM"]],
  commodities:      [75, 65, 55, 78, 10, ["GLD","USO","PDBC","COPX","DBC"]],
  copper:           [72, 60, 60, 85, 8,  ["FCX","COPX","SCCO","TECK","VALE"]],
  housing:          [70, 62, 55, 75, 8,  ["ITB","XHB","DHI","LEN","TOL"]],
  consumer:         [65, 60, 55, 72, 8,  ["XLY","XLP","AMZN","WMT","TGT"]],
  retail:           [62, 65, 52, 78, 10, ["XLY","AMZN","TGT","WMT","COST"]],
  software:         [80, 75, 68, 85, 12, ["CRM","NOW","SNOW","PLTR","ADBE"]],
  cloud:            [82, 78, 70, 85, 14, ["AMZN","MSFT","GOOG","SNOW","DDOG"]],
  cybersecurity:    [78, 72, 65, 88, 10, ["CRWD","ZS","OKTA","PANW","NET"]],
  "emerging markets":[65, 55, 50, 72, 8, ["VWO","EEM","FXI","EWZ","INDA"]],
  reit:             [65, 60, 55, 85, 8,  ["VNQ","XLRE","O","AMT","VICI"]],
  realestate:       [65, 60, 55, 78, 8,  ["VNQ","ITB","XLRE","DRV","REM"]],
  dollar:           [80, 72, 62, 70, 8,  ["UUP","DXY","FXE","EEM","GLD"]],
};

/**
 * Score a theme using deterministic heuristics.
 * Instant — no API call required.
 *
 * @param {string} theme
 * @returns {{ theme, score, dimensions, rationale, topTickers, crowded, emerging, source }}
 */
export function scoreThemeHeuristic(theme) {
  const key  = theme.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "");
  const row  = HEURISTIC_DB[key];

  let marketImpact, catalystFrequency, discussionVelocity, tickerMappability, crowdingPenalty, topTickers;

  if (row) {
    [marketImpact, catalystFrequency, discussionVelocity, tickerMappability, crowdingPenalty, topTickers] = row;
  } else {
    // Unknown theme — conservative defaults
    marketImpact       = 55;
    catalystFrequency  = 50;
    discussionVelocity = 50;
    tickerMappability  = 45;
    crowdingPenalty    = 5;
    topTickers         = [];
  }

  // Weighted score
  const raw =
    (marketImpact      * 0.30) +
    (catalystFrequency * 0.25) +
    (discussionVelocity* 0.20) +
    (tickerMappability * 0.15) -
    (crowdingPenalty   * 0.10);

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    theme,
    score,
    dimensions: { marketImpact, catalystFrequency, discussionVelocity, tickerMappability, crowdingPenalty },
    rationale:  row
      ? `Scored via heuristic map. Market impact ${marketImpact}, catalyst freq ${catalystFrequency}, velocity ${discussionVelocity}, mappability ${tickerMappability}. Crowding penalty: ${crowdingPenalty}.`
      : `Unknown theme — scored with conservative defaults. Consider AI scoring for richer evaluation.`,
    topTickers,
    crowded:    crowdingPenalty >= 20,
    emerging:   discussionVelocity >= 75 && crowdingPenalty < 12,
    source:     "heuristic",
  };
}

// ─── AI scorer ────────────────────────────────────────────────────────────────

/**
 * Score themes using Claude.
 * Batches all themes into a single API call for efficiency.
 *
 * @param {string[]} themes
 * @param {number}   timeoutMs
 * @returns {Promise<ScoredTheme[] | null>}  null on failure
 */
export async function scoreThemesWithAI(themes, timeoutMs = 12_000) {
  if (!themes || themes.length === 0) return [];

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system:     SCORING_SYSTEM_PROMPT,
        messages:   [{
          role:    "user",
          content: `Score these ${themes.length} investment themes by investable attention value for Reddit signal discovery today (April 2026):\n\nThemes: ${themes.map(t => `"${t}"`).join(", ")}\n\nReturn the JSON array now. Be decisive and use the full score range.`,
        }],
      }),
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`API ${res.status}`);

    const data  = await res.json();
    const raw   = data.content.map(b => b.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array");

    const parsed = JSON.parse(match[0]);

    return parsed.map(e => ({
      theme:      e.theme,
      score:      Math.max(0, Math.min(100, e.score || 0)),
      dimensions: e.dimensions || {},
      rationale:  e.rationale  || "",
      topTickers: e.topTickers || [],
      crowded:    e.crowded    ?? false,
      emerging:   e.emerging   ?? false,
      source:     "ai",
    }));

  } catch (err) {
    clearTimeout(timeout);
    console.warn("[themeScorer] AI scoring failed:", err.message);
    return null;
  }
}

// ─── Main scoring function ────────────────────────────────────────────────────

/**
 * Score and rank themes by investable attention value.
 *
 * @param {string[]} themes
 * @param {object}   options
 * @param {boolean}  options.useAI      - use Claude for scoring (default true)
 * @param {number}   options.minScore   - filter threshold (default 50)
 * @param {boolean}  options.includeAll - include all themes regardless of score
 * @returns {Promise<ScoredTheme[]>}  sorted by score DESC
 */
export async function scoreThemes(themes, {
  useAI      = true,
  minScore   = 50,
  includeAll = false,
} = {}) {
  if (!themes || themes.length === 0) return [];

  let scored = null;

  if (useAI) {
    scored = await scoreThemesWithAI(themes);
  }

  // Fallback: heuristic for all, or patch missing AI results
  if (!scored) {
    scored = themes.map(t => scoreThemeHeuristic(t));
  } else {
    // Patch any themes that came back malformed
    const aiThemes = new Set(scored.map(s => s.theme.toLowerCase()));
    themes.forEach(t => {
      if (!aiThemes.has(t.toLowerCase())) {
        scored.push(scoreThemeHeuristic(t));
      }
    });
  }

  const filtered = includeAll
    ? scored
    : scored.filter(s => s.score >= minScore);

  return filtered.sort((a, b) => b.score - a.score);
}
