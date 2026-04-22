// /lib/data/fetchPrices.js
// Fetches real-time quote data from Yahoo Finance via yahoo-finance2
// Install: npm install yahoo-finance2

import YahooFinance from "yahoo-finance2";

/**
 * Fetch latest price data for a list of tickers.
 * @param {string[]} tickers - e.g. ["NVDA", "MSFT", "SPY"]
 * @returns {Promise<Array<{ ticker, price, changePercent, timestamp }>>}
 */
export async function fetchPrices(tickers) {
  const results = [];
  const yahooFinance = new YahooFinance();

  for (const ticker of tickers) {
    try {
      const quote = await yahooFinance.quote(ticker);

      results.push({
        ticker,
        price: quote.regularMarketPrice ?? null,
        changePercent: quote.regularMarketChangePercent ?? 0,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error(`[fetchPrices] Error fetching ${ticker}:`, e.message);
      // Push a null entry so callers always get an entry per ticker
      results.push({
        ticker,
        price: null,
        changePercent: 0,
        timestamp: Date.now(),
        error: true,
      });
    }
  }

  return results;
}
