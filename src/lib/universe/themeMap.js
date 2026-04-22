export const themeMap = {
  AI:               ["NVDA", "MSFT", "AMD"],
  Semiconductors:   ["NVDA", "TSM", "ASML", "SMH"],
  Energy:           ["XOM", "CVX", "GUSH"],
  InterestRates:    ["TLT", "IEF"],
  ConsumerSpending: ["AMZN", "WMT", "COST"],
};

// Narrative keywords associated with each theme — used for signal extraction
export const themeKeywords = {
  AI:               ["AI", "artificial intelligence", "LLM", "GPT", "machine learning", "model", "inference", "data center"],
  Semiconductors:   ["chip", "semiconductor", "fab", "wafer", "GPU", "foundry", "TSMC", "node"],
  Energy:           ["oil", "energy", "crude", "natural gas", "refinery", "pipeline", "OPEC"],
  InterestRates:    ["Fed", "interest rate", "yield", "treasury", "bonds", "FOMC", "rate cut", "rate hike"],
  ConsumerSpending: ["consumer", "retail", "spending", "e-commerce", "inflation", "discretionary"],
};
