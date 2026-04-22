// /pages/api/data.js
// Thin orchestration route. Business logic lives in /lib/data/*.
// GET  /api/data -> returns merged signals for all tickers
// GET  /api/data?tickers=NVDA,AAPL -> custom ticker list

import { fetchPrices } from "@/lib/data/fetchPrices";
import { fetchAttention } from "@/lib/data/reddit";
import { mergeSignals } from "@/lib/data/mergeSignals";
import { savePrices, saveAttention } from "@/lib/data/store";

const DEFAULT_TICKERS = ["NVDA", "MSFT", "SPY", "GUSH", "AAPL", "TSLA"];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const tickers = req.query.tickers
    ? req.query.tickers.split(",").map((ticker) => ticker.trim().toUpperCase())
    : DEFAULT_TICKERS;

  try {
    const [prices, attention] = await Promise.all([
      fetchPrices(tickers),
      fetchAttention(tickers),
    ]);

    // Persist to store (fire-and-forget - do not block the response)
    savePrices(prices);
    saveAttention(attention);

    const signals = mergeSignals(tickers, prices, attention);

    return res.status(200).json({
      signals,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    console.error("[api/data] Pipeline error:", e);
    return res.status(500).json({ error: "Pipeline failed", detail: e.message });
  }
}
