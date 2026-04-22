// /lib/pipeline/themeExpander.js
//
// Theme → Reddit search query expansion.
// Three-tier strategy (fastest/cheapest first, highest quality when available):
//
//   TIER 1 — AI expansion (Claude)   highest signal, context-aware, handles any theme
//   TIER 2 — Static map              hand-tuned, instant, covers ~35 known themes
//   TIER 3 — Template generator      last resort, always works, lowest signal quality
//
// The AI tier is attempted first. On failure (timeout, rate limit, no API key),
// the system falls through to the static map silently — zero pipeline disruption.

import { expandThemesWithAI } from "./aiThemeExpander.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export const EXPANDER_CONFIG = {
  maxQueriesPerRun:  5,   // hard cap on total queries sent to Reddit
  queriesPerTheme:   2,   // queries taken from each theme's list before cap
  aiQueriesPerTheme: 4,   // queries to request from Claude per theme
  useAI:             true, // set false to always use static map (e.g. CI/testing)
};

// ─── Tier 2: Static theme → query map ────────────────────────────────────────
// Hand-tuned for high Reddit signal quality.
// Ordered by signal value within each theme (best queries first).

const STATIC_MAP = {
  // ── Technology ──────────────────────────────────────────────────────────────
  ai: [
    "AI stocks earnings catalyst",
    "Nvidia AMD AI datacenter thesis",
    "AI infrastructure capex bubble overcrowded",
    "semiconductor AI demand undervalued plays",
  ],
  semiconductor: [
    "semiconductor stocks earnings outlook",
    "TSMC ASML NVDA AMD supply chain thesis",
    "semiconductor cycle bottom contrarian",
    "chip shortage demand recovery",
  ],
  cloud: [
    "cloud computing stocks earnings beat",
    "AWS Azure Google Cloud revenue growth",
    "SaaS valuation multiple compression",
    "cloud spending slowdown bear case",
  ],
  software: [
    "software stocks earnings beat ARR",
    "SaaS growth undervalued contrarian",
    "enterprise software budget freeze headwinds",
  ],
  cybersecurity: [
    "cybersecurity stocks earnings CRWD ZS",
    "cyber spending regulation catalyst",
    "cybersecurity bubble overcrowded",
  ],

  // ── Energy ──────────────────────────────────────────────────────────────────
  oil: [
    "oil prices energy stocks thesis",
    "crude oil OPEC supply cut CVX XOM",
    "energy sector earnings beat",
    "oil demand destruction bear case",
  ],
  energy: [
    "energy stocks earnings outlook XLE",
    "oil gas supply demand thesis",
    "energy transition headwinds fossil fuel",
  ],
  uranium: [
    "uranium nuclear energy stocks CCJ URA",
    "nuclear renaissance catalyst utilities",
    "uranium supply deficit thesis",
    "nuclear power overcrowded retail bubble",
  ],
  solar: [
    "solar energy stocks FSLR ENPH earnings",
    "IRA subsidy solar catalyst",
    "solar margin compression headwinds",
  ],
  renewables: [
    "renewable energy stocks ETF ICLN TAN",
    "clean energy regulation catalyst",
    "renewables subsidy cliff bear case",
  ],

  // ── Macro / Rates ────────────────────────────────────────────────────────────
  "interest rates": [
    "Fed rate cut stocks thesis TLT",
    "rate sensitive sectors beneficiaries",
    "duration trade ZROZ IEF bond thesis",
    "higher for longer rates bear case equities",
  ],
  rates: [
    "Fed interest rate decision stocks impact",
    "rate cut beneficiaries thesis",
    "rate hike recession risk",
  ],
  inflation: [
    "inflation hedge stocks commodities thesis",
    "CPI earnings impact stagflation",
    "inflation cooling disinflation catalyst",
    "inflation breakout bear case equities",
  ],
  recession: [
    "recession proof stocks defensive thesis",
    "bear market macro outlook positioning",
    "soft landing vs recession debate",
    "recession hedge portfolio strategy",
  ],
  macro: [
    "macro thesis stocks bonds outlook",
    "global economy slowdown market impact",
    "macro rotation trade sectors",
    "macro bull bear case debate",
  ],

  // ── Crypto / Digital Assets ──────────────────────────────────────────────────
  crypto: [
    "crypto stocks Bitcoin thesis MSTR COIN",
    "Bitcoin ETF IBIT inflows catalyst",
    "crypto regulatory crackdown bear case",
    "crypto cycle altcoin rotation",
  ],
  bitcoin: [
    "Bitcoin price thesis halving catalyst",
    "BTC ETF inflows IBIT FBTC",
    "Bitcoin mining stocks earnings",
    "Bitcoin bubble bear case regulation",
  ],
  ethereum: [
    "Ethereum ETH staking yield thesis",
    "ETH upgrade catalyst institutional",
    "Ethereum vs Bitcoin debate",
  ],

  // ── Healthcare / Biotech ────────────────────────────────────────────────────
  biotech: [
    "biotech earnings FDA approval catalyst",
    "XBI IBB small cap biotech undervalued",
    "biotech binary event risk",
    "biotech overcrowded bubble bear case",
  ],
  healthcare: [
    "healthcare stocks earnings thesis",
    "pharma drug approval pipeline catalyst",
    "healthcare regulation pricing pressure",
  ],
  "weight loss": [
    "GLP-1 obesity drug stocks LLY NVO",
    "Novo Nordisk Eli Lilly thesis earnings",
    "weight loss drug competition crowded",
  ],
  glp1: [
    "GLP-1 stocks LLY NVO thesis",
    "obesity drug pipeline competition",
    "GLP-1 supply constraint catalyst",
  ],

  // ── Consumer / Retail ────────────────────────────────────────────────────────
  consumer: [
    "consumer spending discretionary stocks thesis",
    "consumer sentiment earnings impact XLY",
    "consumer recession stress bear case",
  ],
  retail: [
    "retail earnings beat miss thesis",
    "e-commerce growth Amazon target",
    "consumer discretionary headwinds",
  ],
  ev: [
    "EV stocks earnings TSLA RIVN NIO",
    "electric vehicle demand slowdown bear",
    "EV battery supply chain catalyst",
    "EV competition price war margin compression",
  ],

  // ── Financials ───────────────────────────────────────────────────────────────
  banks: [
    "bank stocks earnings net interest margin",
    "JPM BAC GS thesis capital return",
    "regional bank stress commercial real estate",
    "bank earnings beat rate spread",
  ],
  fintech: [
    "fintech stocks earnings PYPL SQ SOFI",
    "payments fintech growth thesis",
    "fintech regulation headwinds bear",
  ],

  // ── Commodities ──────────────────────────────────────────────────────────────
  gold: [
    "gold stocks GLD GDX thesis hedge",
    "gold miners earnings leverage thesis",
    "gold bubble overcrowded bear case",
  ],
  commodities: [
    "commodity stocks supercycle thesis",
    "copper gold oil supply demand",
    "commodity inflation hedge portfolio",
  ],
  copper: [
    "copper stocks demand EV infrastructure",
    "Freeport copper supply thesis",
    "copper demand destruction recession",
  ],

  // ── China / Emerging Markets ─────────────────────────────────────────────────
  china: [
    "China stocks ADR stimulus thesis BABA JD",
    "China economy recovery catalyst",
    "China tech regulation risk bear case",
    "China decoupling geopolitical risk",
  ],
  "emerging markets": [
    "emerging markets stocks ETF VWO thesis",
    "EM dollar strength headwinds",
    "emerging market catalyst reform",
  ],

  // ── Real Estate ──────────────────────────────────────────────────────────────
  realestate: [
    "REIT stocks earnings thesis dividend",
    "commercial real estate distress bear case",
    "housing market stocks thesis",
  ],
  reit: [
    "REIT earnings dividend yield thesis",
    "VICI AMT REIT rate sensitivity",
    "office REIT distress bear case",
  ],
};

// ─── Tier 3: Template fallback ────────────────────────────────────────────────

function buildTemplateQueries(theme) {
  const t = theme.toLowerCase().trim();
  return [
    `${t} stocks earnings thesis`,
    `${t} investment catalyst outlook`,
    `${t} bull bear case debate`,
    `${t} sector undervalued opportunities`,
  ];
}

// ─── Normalise theme key ──────────────────────────────────────────────────────

function normalise(theme) {
  return theme.toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

// ─── Main expansion function ──────────────────────────────────────────────────

/**
 * Expand an array of themes into a capped, ranked list of search queries.
 *
 * Strategy waterfall:
 *   1. AI expansion (Claude) — if EXPANDER_CONFIG.useAI and API available
 *   2. Static map — for known themes
 *   3. Template generator — for unknown themes with no AI
 *
 * @param {string[]} themes  e.g. ["AI", "oil", "interest rates"]
 * @param {object}   options
 * @param {boolean}  options.useAI  - override config useAI setting
 * @returns {Promise<Array<{ theme: string, query: string, source: "ai"|"static"|"template" }>>}
 */
export async function expandThemes(themes, { useAI = EXPANDER_CONFIG.useAI } = {}) {
  if (!themes || themes.length === 0) return [];

  let expansions = null; // Array<{ theme, queries, source }>

  // ── Tier 1: AI expansion ───────────────────────────────────────────────────
  if (useAI) {
    expansions = await expandThemesWithAI(themes, {
      queriesPerTheme: EXPANDER_CONFIG.aiQueriesPerTheme,
    });
    // null return = AI failed, fall through
  }

  // ── Tier 2 + 3: Static map / template (per-theme, fills AI gaps) ───────────
  if (!expansions) {
    // Full static/template fallback for all themes
    expansions = themes.map(raw => {
      const key     = normalise(raw);
      const queries = STATIC_MAP[key] ?? buildTemplateQueries(raw);
      return {
        theme:   raw,
        queries: queries.slice(0, EXPANDER_CONFIG.aiQueriesPerTheme),
        source:  STATIC_MAP[key] ? "static" : "template",
      };
    });
  } else {
    // Patch any themes that came back with empty queries from AI
    expansions = expansions.map(exp => {
      if (exp.queries.length > 0) return exp;
      const key     = normalise(exp.theme);
      const queries = STATIC_MAP[key] ?? buildTemplateQueries(exp.theme);
      return { ...exp, queries, source: STATIC_MAP[key] ? "static" : "template" };
    });
  }

  // ── Flatten to query list, enforce caps ────────────────────────────────────
  const flat = [];
  for (const { theme, queries, source } of expansions) {
    queries.slice(0, EXPANDER_CONFIG.queriesPerTheme).forEach(query => {
      flat.push({ theme, query, source });
    });
  }

  // Total query cap — themes listed first get priority
  const capped = flat.slice(0, EXPANDER_CONFIG.maxQueriesPerRun);

  console.log(
    `[themeExpander] ${themes.length} themes → ${capped.length} queries ` +
    `(source: ${[...new Set(capped.map(c => c.source))].join(", ")})`
  );

  return capped;
}

/**
 * List all themes with static query maps (for UI theme-picker / autocomplete).
 * @returns {string[]}
 */
export function getSupportedThemes() {
  return Object.keys(STATIC_MAP);
}

/**
 * Preview expansion for a set of themes without executing searches.
 * Useful for UI "dry preview" before committing to a pipeline run.
 *
 * @param {string[]} themes
 * @param {boolean}  useAI
 * @returns {Promise<Array<{ theme, queries, source }>>}
 */
export async function previewExpansion(themes, useAI = EXPANDER_CONFIG.useAI) {
  if (!themes || themes.length === 0) return [];

  let expansions = useAI ? await expandThemesWithAI(themes, {
    queriesPerTheme: EXPANDER_CONFIG.aiQueriesPerTheme,
  }) : null;

  if (!expansions) {
    expansions = themes.map(raw => {
      const key     = normalise(raw);
      const queries = STATIC_MAP[key] ?? buildTemplateQueries(raw);
      return { theme: raw, queries, source: STATIC_MAP[key] ? "static" : "template" };
    });
  }

  return expansions;
}
