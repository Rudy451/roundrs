// /lib/data/mergeSignals.js
// Combines price data and Reddit attention into unified per-ticker signal objects.
// Kept intentionally thin — no scoring logic here yet.

/*
 * Merge price + attention arrays into a unified signal per ticker.
 *
 * @param {string[]} tickers
 * @param {Array<{ ticker, price, changePercent, timestamp }>} prices
 * @param {Array<{ ticker, mentions, timestamp }>} attention
 * @returns {Array<{
 *   ticker: string,
 *   price: number | null,
 *   changePercent: number,
 *   attention: number,
 *   priceTimestamp: number | null,
 *   attentionTimestamp: number | null,
 * }>}
 */

export function mergeSignals(tickers, prices, attention) {
  return tickers.map((t) => {
    const price = prices.find((p) => p.ticker === t);
    const att = attention.find((a) => a.ticker === t);

    return {
      ticker: t,
      price: price?.price ?? null,
      changePercent: price?.changePercent ?? 0,
      attention: att?.mentions ?? 0,
      priceTimestamp: price?.timestamp ?? null,
      attentionTimestamp: att?.timestamp ?? null,
    }
  })
}
