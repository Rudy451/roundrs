# DraftBoard Data Pipeline

Minimal, modular data pipeline for real market signals.

---

## File Map

```
/lib/data/
  fetchPrices.js   ← Yahoo Finance price fetcher
  store.js         ← In-memory + JSON file persistence
  reddit.js        ← Reddit attention engine
  mergeSignals.js  ← Combine price + attention per ticker

/pages/api/
  data.js          ← GET /api/data — orchestrates the pipeline

/components/
  DraftBoard.jsx   ← UI component, polls /api/data every 60s
```

---

## Setup

### 1. Install dependency

```bash
npm install yahoo-finance2
```

No other paid APIs or keys needed.

### 2. Drop files into your project

Copy each file to its path as shown above.

### 3. Use the component

```jsx
// pages/index.js or app/page.jsx
import DraftBoard from "@/components/DraftBoard";

export default function Home() {
  return <DraftBoard tickers={["NVDA", "MSFT", "SPY", "GUSH", "AAPL"]} />;
}
```

### 4. Hit the API directly

```
GET /api/data
GET /api/data?tickers=NVDA,TSLA,META
```

Response shape:
```json
{
  "signals": [
    {
      "ticker": "NVDA",
      "price": 910.23,
      "changePercent": 1.23,
      "attention": 42,
      "priceTimestamp": 1712700000000,
      "attentionTimestamp": 1712700000000
    }
  ],
  "fetchedAt": 1712700000000
}
```

---

## Data Storage

Persisted automatically to `.data/store.json` in your project root.
Add `.data/` to `.gitignore`.

```
.data/
  store.json    ← price + attention history, capped at 500 entries/ticker
```

---

## Reddit Signals

- Scrapes `r/wallstreetbets`, `r/stocks`, `r/investing`, `r/StockMarket`
- Uses Reddit's public JSON API (no key needed)
- Falls back to mock data if Reddit rate-limits the request
- Counts whole-word ticker matches (avoids false positives)

---

## Extending This

| Goal | Where |
|------|-------|
| Add more tickers | `DEFAULT_TICKERS` in `pages/api/data.js` |
| More subreddits | `SUBREDDITS` in `lib/data/reddit.js` |
| Swap storage to SQLite | Replace `store.js` internals only |
| Add scoring/conviction | New file `lib/data/scoreSignals.js` |
| Add backtesting | New file `lib/data/backtest.js` using `getPriceHistory()` |
| Scheduled refresh | Add a cron route at `pages/api/cron.js` |
