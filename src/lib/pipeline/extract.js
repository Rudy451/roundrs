// /lib/pipeline/extract.js
// Stage 3: Ticker extraction.
// Robust pattern matching with blocklist filtering.
// Optionally validates against a known ticker set.

// ─── Blocklist ────────────────────────────────────────────────────────────────
// Common English words and abbreviations that match the 2-5 uppercase pattern.
// This list is aggressive — better to miss a real ticker than spam false positives.

const BLOCKLIST = new Set([
  // Articles / conjunctions / prepositions
  "A", "AN", "THE", "AND", "OR", "BUT", "FOR", "NOR", "SO", "YET",
  "AT", "BY", "IN", "OF", "ON", "TO", "UP", "AS",
  // Common short words
  "IT", "IS", "BE", "DO", "GO", "NO", "IF", "MY", "WE", "HE", "ME",
  "US", "HI", "OK", "AM", "PM", "VS",
  // Finance-adjacent noise
  "ALL", "ARE", "NEW", "NOW", "BUY", "SELL", "PUT", "GET", "HAS",
  "LOW", "HIGH", "YES", "NOT", "TOP", "HOT", "DUE", "OUT", "OFF",
  "ADD", "CEO", "CFO", "COO", "IPO", "ATH", "ATL", "YTD", "QOQ",
  "YOY", "EPS", "FCF", "NET", "GDP", "CPI", "FED", "SEC", "IMF",
  "WHO", "WTO", "IRS", "ETF", "NAV", "ROI", "APY", "APR",
  // Reddit culture
  "LOL", "WTF", "IMO", "IMHO", "FYI", "TLDR", "TBH", "NGL",
  "HODL", "FOMO", "YOLO", "MOON", "BEAR", "BULL", "PUMP",
  "DUMP", "GANG", "PLAY", "PUTS", "CALL", "CALLS", "WHEN",
  "THEN", "THIS", "THAT", "THEM", "THEY", "WHAT", "WITH", "FROM",
  "HAVE", "WILL", "MORE", "ALSO", "LIKE", "JUST", "VERY", "GOOD",
  "BEEN", "SAID", "SAYS", "YOUR", "WANT", "MAKE", "MADE", "MOVE",
  "DOWN", "NEXT", "SOME", "INTO", "OVER", "BACK", "WELL", "EVEN",
  "MUCH", "MOST", "TAKE", "LONG", "SAME", "ONLY", "BOTH", "KEEP",
  "WENT", "YEAR", "WEEK", "DAYS", "DEBT", "RATE", "RISK", "REAL",
  "CASH", "COST", "LOST", "LOTS", "EASY", "HARD", "HUGE", "KNOW",
  "NEWS", "HOLD", "SOLD", "NEED", "POST", "TIME", "IDEA", "GAIN",
  "LOSS", "FUND", "BANK", "BASE", "DATA", "OPEN", "GIVE", "ONCE",
  "SEEN", "LESS", "NICE", "FAST", "LOWS", "OWNS", "NEAR", "PAST",
  "PLAN", "TALK", "TELL", "CANT", "DONT", "WONT", "DIDNT",
  // 2-letter noise
  "AI", "EV", "VP", "HR", "PR", "IT", "UK", "EU", "US",
]);

// ─── Ticker regex ─────────────────────────────────────────────────────────────
// Matches 2–5 uppercase letters as whole words.
// Applied AFTER normalization, so text is already clean.

const TICKER_REGEX = /\b([A-Z]{2,5})\b/g;

/**
 * Extract unique tickers from normalized text.
 *
 * @param {string} text - normalized post text (uppercase-safe)
 * @param {Set<string>|null} knownTickers - optional validation set
 * @returns {string[]} deduplicated ticker array for this post
 */
export function extractTickers(text, knownTickers = null) {
  const upper = text.toUpperCase();
  const matches = upper.match(TICKER_REGEX) || [];
  const found = new Set();

  for (const m of matches) {
    if (BLOCKLIST.has(m)) continue;
    if (knownTickers && !knownTickers.has(m)) continue;
    found.add(m);
  }

  return Array.from(found);
}

/**
 * Extract tickers from an array of normalized post objects.
 *
 * @param {Array<{ post: Post, normalizedText: string }>} normalized
 * @param {Set<string>|null} knownTickers
 * @returns {Array<{ post: Post, tickers: string[] }>}
 */
export function extractFromPosts(normalized, knownTickers = null) {
  return normalized.map(({ post, normalizedText }) => ({
    post,
    tickers: extractTickers(normalizedText, knownTickers),
  }));
}

// ─── Known ticker list (lightweight, most-traded US equities + ETFs) ──────────
// This is a curated ~300-ticker seed list. Swap with a full list from a free
// source (e.g. SEC EDGAR, nasdaq.com) for production use.

export const KNOWN_TICKERS = new Set([
  // Mega cap
  "AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","META","TSLA","AVGO","BRK",
  "BRKB","BRKA","LLY","V","UNH","JPM","XOM","MA","JNJ","PG",
  // Large cap tech
  "AMD","INTC","QCOM","ORCL","CRM","ADBE","NOW","SNOW","PLTR","UBER",
  "LYFT","SHOP","SQ","PYPL","COIN","HOOD","RBLX","U","DDOG","CRWD",
  "ZS","NET","OKTA","TWLO","MDB","GTLB","HUBS","TEAM","ZM","DOCU",
  // Finance
  "BAC","GS","MS","WFC","C","BLK","SCHW","AXP","USB","TFC",
  // Healthcare / biotech
  "MRNA","PFE","ABBV","BMY","GILD","BIIB","REGN","VRTX","ISRG","MDT",
  "CVS","UNH","HCA","CI","ABC","MCK","CELH","HIMS","RXRX",
  // Energy
  "XOM","CVX","COP","SLB","EOG","PXD","MPC","VLO","PSX","OXY",
  "GUSH","ERX","UCO","USO","XLE",
  // Consumer
  "AMZN","WMT","COST","TGT","HD","LOW","MCD","SBUX","NKE","LULU",
  "DECK","TPR","RL","PVH","GPS","URBN",
  // Semi / hardware
  "TSM","ASML","AMAT","LRCX","KLAC","MU","STX","WDC","MRVL","ON",
  "SMCI","ARM","WOLF","OLED","SLAB",
  // Auto / EV
  "TSLA","F","GM","RIVN","LCID","NIO","XPEV","LI","STLA","TM","HMC",
  // ETFs
  "SPY","QQQ","IWM","DIA","VTI","VOO","VXX","UVXY","SQQQ","TQQQ",
  "SPXL","SPXS","TLT","IEF","HYG","LQD","GLD","SLV","GDX","GDXJ",
  "XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLRE","XLC","XLB","XLU",
  "ARKK","ARKG","ARKW","ARKF","ARKX","BOTZ","ROBO","HERO",
  "URA","CCJ","NLR","URNM","FSLR","ENPH","SEDG","TAN","ICLN",
  "IBB","XBI","LABU","LABD","SOXL","SOXS","FNGU","FNGD",
  // Misc popular
  "GME","AMC","BBBY","MSTR","BB","NOK","CLOV","WISH","SPCE","NKLA",
  "PLBY","EXPR","KOSS","SNDL","TLRY","APHA","CGC","ACB","CRON",
  "SOFI","LCII","DKNG","PENN","CZAR","MGM","WYNN","LVS","VICI",
  "ZI","OPEN","OPENDOOR","OPAD","OFFERPAD",
]);
