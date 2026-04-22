// /lib/pipeline/extract.js
// Stage 3: Ticker extraction and validation.
//
// Three-tier validation:
//   Tier 1 — Blocklist: hard exclusion of common English words
//   Tier 2 — Known list: validate against curated ticker set (recommended)
//   Tier 3 — Heuristic: structural validation when no known list provided
//
// Extraction order matters:
//   1. $-prefixed tickers (highest confidence — user intentionally flagged)
//   2. ALL-CAPS words that survived normalization (medium confidence)
//
// Input:  Array<{ post: Post, normalizedText: string }> from normalize stage
// Output: Array<{ post: Post, tickers: string[] }> — tickers per post

import { edgeLog } from "./edgeLog.js";

// ─── Tier 1: Blocklist ────────────────────────────────────────────────────────
// Aggressive — better to miss a real ticker than surface junk.
// Any word that regularly appears as English text in investment forums goes here.

export const BLOCKLIST = new Set([
  // Prepositions / articles / conjunctions
  "A","AN","THE","AND","OR","BUT","FOR","NOR","SO","YET",
  "AT","BY","IN","OF","ON","TO","UP","AS","IF","BE",

  // Pronouns / common verbs
  "IT","IS","DO","GO","NO","MY","WE","HE","ME","US",
  "HI","OK","AM","PM","VS","IM",

  // Common adjectives / adverbs
  "ALL","ARE","NEW","NOW","NOT","YES","TOP","HOT","LOW","HIGH",
  "OLD","BIG","BAD","DUE","OUT","OFF","OWN","RAW","DRY","WET",

  // Finance jargon (not tickers)
  "BUY","SELL","PUT","CALL","CALLS","PUTS","GET","HAS","ADD",
  "CEO","CFO","COO","CTO","IPO","ATH","ATL","YTD","QOQ","YOY",
  "EPS","FCF","NET","GDP","CPI","PPI","FED","SEC","IMF","IRS",
  "ETF","NAV","ROI","APY","APR","AUM","IRR","NPV","DCF","PE",
  "WHO","WTO","NATO","OPEC",

  // Reddit / social media culture
  "LOL","WTF","IMO","IMHO","FYI","TLDR","TBH","NGL","SMH",
  "HODL","FOMO","YOLO","MOON","BEAR","BULL","PUMP","DUMP",
  "GANG","PLAY","WHEN","THEN","THIS","THAT","THEM","THEY",
  "WHAT","WITH","FROM","HAVE","WILL","MORE","ALSO","LIKE",
  "JUST","VERY","GOOD","BEEN","SAID","YOUR","WANT","MAKE",
  "MADE","MOVE","DOWN","NEXT","SOME","INTO","OVER","BACK",
  "WELL","EVEN","MUCH","MOST","TAKE","LONG","SAME","ONLY",
  "BOTH","KEEP","WENT","YEAR","WEEK","DAYS","DEBT","RATE",
  "RISK","REAL","CASH","COST","LOST","EASY","HARD","HUGE",
  "KNOW","NEWS","HOLD","SOLD","NEED","POST","TIME","IDEA",
  "GAIN","LOSS","FUND","BANK","BASE","DATA","OPEN","GIVE",
  "ONCE","SEEN","LESS","FAST","PAST","PLAN","TALK","TELL",
  "CANT","DONT","WONT","WAYS","PAYS","SAYS","GOES","DOES",
  "MADE","PUTS","CALL","RISE","FELL","FELL","DROP","FALL",

  // Common 2-letter non-tickers
  "AI","EV","VP","HR","PR","IT","UK","EU","US","VC",
  "PE","RE","MO","GO","SO","DO","NO","TO","BY","MY",
]);

// ─── Tier 2: Known ticker list ────────────────────────────────────────────────
// Curated ~350-ticker set. Replace with a full list from SEC EDGAR or
// Nasdaq for production use (see comments at end of file).

export const KNOWN_TICKERS = new Set([
  // Mega cap
  "AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","META","TSLA","AVGO",
  "LLY","V","UNH","JPM","XOM","MA","JNJ","PG","HD","MRK",

  // Large cap tech
  "AMD","INTC","QCOM","ORCL","CRM","ADBE","NOW","SNOW","PLTR","UBER",
  "LYFT","SHOP","SQ","PYPL","COIN","HOOD","RBLX","DDOG","CRWD",
  "ZS","NET","OKTA","TWLO","MDB","GTLB","HUBS","TEAM","ZM","DOCU",
  "PANW","FTNT","S","ESTC","CFLT","BILL","DOCN","AFRM","UPST",

  // Finance
  "BAC","GS","MS","WFC","C","BLK","SCHW","AXP","USB","TFC",
  "SPGI","MCO","ICE","CME","CBOE","NDAQ","BX","KKR","APO","CG",

  // Healthcare / biotech / pharma
  "MRNA","PFE","ABBV","BMY","GILD","BIIB","REGN","VRTX","ISRG","MDT",
  "CVS","HCA","CI","ABC","MCK","CELH","HIMS","RXRX","INMD","NVCR",
  "ACHR","ARDX","CRSP","EDIT","NTLA","BEAM","VERV","BLUE",

  // Energy
  "XOM","CVX","COP","SLB","EOG","PXD","MPC","VLO","PSX","OXY",
  "GUSH","ERX","UCO","USO","XLE","HAL","BKR","NOV","DVN","FANG",

  // Consumer
  "WMT","COST","TGT","LOW","MCD","SBUX","NKE","LULU","DECK","TPR",
  "BURL","ROST","TJX","BBY","KSS","M","GPS","URBN","ANF","AEO",

  // Semi / hardware
  "TSM","ASML","AMAT","LRCX","KLAC","MU","STX","WDC","MRVL","ON",
  "SMCI","ARM","WOLF","OLED","SLAB","MPWR","ENPH","FSLR","SEDG",
  "ONTO","AMKR","COHR","IPGP","IIVI","MACOM","FORM","ACLS","ICHR",

  // Auto / EV
  "TSLA","F","GM","RIVN","LCID","NIO","XPEV","LI","STLA","TM","HMC",
  "RACE","BMWYY","VWAPY","FSR","GOEV","WKHS","RIDE","NKLA","HYLN",

  // ETFs — broad
  "SPY","QQQ","IWM","DIA","VTI","VOO","VXX","UVXY","SQQQ","TQQQ",
  "SPXL","SPXS","TLT","IEF","HYG","LQD","GLD","SLV","GDX","GDXJ",

  // ETFs — sector
  "XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLRE","XLC","XLB","XLU",
  "ARKK","ARKG","ARKW","ARKF","ARKX","BOTZ","ROBO","HERO",
  "URA","CCJ","NLR","URNM","TAN","ICLN","IBB","XBI",
  "LABU","LABD","SOXL","SOXS","FNGU","FNGD","WEBL","WEBS",
  "ZROZ","IBIT","FBTC","BITO","GBTC",

  // Crypto-adjacent equities
  "MSTR","RIOT","MARA","CLSK","CORZ","HUT","BTBT","CIFR",

  // Misc high-attention
  "GME","AMC","MSTR","BB","NOK","SPCE","SOFI","DKNG","PENN",
  "MGM","WYNN","LVS","VICI","RDFN","OPEN","OPAD","NRDY",

  // Commodities / macro
  "GLD","SLV","USO","UNG","DBO","PDBC","CORN","WEAT","SOYB",
  "DXY","UUP","FXE","EEM","VWO","FXI","KWEB","MCHI",

  // REITs
  "VNQ","XLRE","O","AMT","VICI","SPG","EQR","AVB","PSA","PLD",
]);

// ─── Ticker regex ─────────────────────────────────────────────────────────────

// Matches 2–5 uppercase letters as whole words.
// The text has already been uppercased by normalizeText().
const TICKER_REGEX = /\b([A-Z]{2,5})\b/g;

// ─── Heuristic validator (Tier 3) ────────────────────────────────────────────
// Applied when knownTickers = null. Structural rules only.

function passesHeuristic(token) {
  // Must be 2–5 chars (already enforced by regex, double-check)
  if (token.length < 2 || token.length > 5) return false;

  // Must contain at least one vowel OR be a known ETF-like pattern
  // (purely consonantal strings like "BCDF" are almost never real tickers)
  const hasVowel = /[AEIOU]/.test(token);
  const looksLikeETF = token.length >= 3; // ETFs are usually 3+ chars

  return hasVowel || looksLikeETF;
}

// ─── Main extraction function ─────────────────────────────────────────────────

/**
 * Extract unique tickers from a single normalized text string.
 *
 * @param {string} text          — normalized (uppercase) post text
 * @param {Set<string>|null} knownTickers — optional validation set
 * @returns {string[]} — unique, validated tickers found in this text
 */
export function extractTickers(text, knownTickers = KNOWN_TICKERS) {
  const matches = text.match(TICKER_REGEX) || [];
  const found   = new Set();
  const rejected = [];

  for (const token of matches) {
    // Tier 1: blocklist
    if (BLOCKLIST.has(token)) continue;

    // Tier 2: known list (if provided)
    if (knownTickers) {
      if (knownTickers.has(token)) {
        found.add(token);
      } else {
        rejected.push(token);
      }
      continue;
    }

    // Tier 3: heuristic (no known list)
    if (passesHeuristic(token)) {
      found.add(token);
    }
  }

  // Log novel tokens that were rejected by known list — candidates for list expansion
  if (rejected.length > 0 && process.env.DRAFTBOARD_LOG_NOVEL_TICKERS === "true") {
    const novel = rejected.filter(t => !BLOCKLIST.has(t));
    if (novel.length > 0) {
      edgeLog("extract", "novel_tokens", { tokens: [...new Set(novel)].slice(0, 10) });
    }
  }

  return Array.from(found);
}

/**
 * Extract tickers from an array of normalized post objects.
 * Attaches extracted tickers directly to each Post object.
 *
 * @param {Array<{ post: Post, normalizedText: string }>} normalized
 * @param {Set<string>|null} knownTickers
 * @returns {Array<{ post: Post, tickers: string[] }>}
 */
export function extractFromPosts(normalized, knownTickers = KNOWN_TICKERS) {
  return normalized.map(({ post, normalizedText }) => {
    const tickers = extractTickers(normalizedText, knownTickers);

    // Attach directly to post for downstream use
    post.extractedTickers = tickers;

    return { post, tickers };
  });
}

// ─── PRODUCTION UPGRADE NOTE ──────────────────────────────────────────────────
//
// The KNOWN_TICKERS set is a curated seed (~350 tickers).
// For full coverage, replace it with a dynamic list loaded at startup:
//
//   Option 1 — SEC EDGAR company tickers (free, daily updated):
//   https://www.sec.gov/files/company_tickers.json
//
//   Option 2 — Nasdaq listed securities (free CSV):
//   https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt
//
//   Load on startup, cache in store.js, reload daily.
//   Pass as knownTickers to extractFromPosts().
//
