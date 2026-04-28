// /lib/pipeline/mockData.js
//
// Shared mock dataset for dry runs and tests.
// Uses canonical Post schema fields throughout (post.js).
//
// Single source of truth — imported by runner.js and any test that needs
// realistic pipeline input without hitting Reddit.

export function getMockBatch() {
  const now = Math.floor(Date.now() / 1000);

  const posts = [
    {
      id: "mock1", subreddit: "wallstreetbets", source: "hot", theme: null,
      title: "SMCI is massively undervalued — AI server exposure nobody talking about",
      body:  "SMCI liquid cooling partnership with NVDA. Revenue guidance $14-15B. Completely overlooked.",
      upvotes: 1240, numComments: 340, createdUtc: now - 1800, url: "#", extractedTickers: [],
    },
    {
      id: "mock2", subreddit: "stocks", source: "hot", theme: null,
      title: "CELH deep dive — why the selloff is overdone",
      body:  "CELH down 60% from highs. PEP distribution intact. International expansion UK France Australia.",
      upvotes: 445, numComments: 89, createdUtc: now - 3600, url: "#", extractedTickers: [],
    },
    {
      id: "mock3", subreddit: "wallstreetbets", source: "theme", theme: "AI",
      title: "NVDA AI infrastructure thesis — capex cycle just starting",
      body:  "NVDA AMD SMCI — entire AI buildout stack. Hyperscalers still accelerating capex.",
      upvotes: 2890, numComments: 720, createdUtc: now - 600, url: "#", extractedTickers: [],
    },
    {
      id: "mock4", subreddit: "investing", source: "theme", theme: "interest rates",
      title: "TLT and IEF for the rate cut trade — ZROZ for maximum duration",
      body:  "Most asymmetric macro setup in 3 years. 10yr at 5% is unsustainable given debt service costs.",
      upvotes: 312, numComments: 156, createdUtc: now - 7200, url: "#", extractedTickers: [],
    },
    {
      id: "mock5", subreddit: "stocks", source: "theme", theme: "uranium",
      title: "CCJ uranium thesis — 10 year supply deal just signed",
      body:  "CCJ signed major utility agreement. Nuclear renaissance is real. URA for diversified exposure.",
      upvotes: 567, numComments: 203, createdUtc: now - 2400, url: "#", extractedTickers: [],
    },
    {
      id: "mock6", subreddit: "wallstreetbets", source: "hot", theme: null,
      title: "GME Roaring Kitty is back — all in",
      body:  "GME calls. Diamond hands. To the moon.",
      upvotes: 3200, numComments: 1400, createdUtc: now - 900, url: "#", extractedTickers: [],
    },
    {
      id: "mock7", subreddit: "investing", source: "theme", theme: "crypto",
      title: "MSTR vs IBIT — the NAV premium argument",
      body:  "MSTR trades at 2x NAV to BTC holdings. With IBIT and FBTC available the arb will close.",
      upvotes: 289, numComments: 78, createdUtc: now - 5400, url: "#", extractedTickers: [],
    },
    {
      id: "mock8", subreddit: "stocks", source: "theme", theme: "AI",
      title: "AMD vs NVDA in AI data center — who wins long term",
      body:  "AMD MI300 gaining ground. NVDA dominant but AMD closing gap on pricing.",
      upvotes: 678, numComments: 234, createdUtc: now - 4800, url: "#", extractedTickers: [],
    },
    {
      id: "mock9", subreddit: "wallstreetbets", source: "hot", theme: null,
      title: "PLTR earnings — government contracts expanding",
      body:  "PLTR DoD contracts. AIP is real. Commercial segment growing 55% YoY.",
      upvotes: 891, numComments: 312, createdUtc: now - 1200, url: "#", extractedTickers: [],
    },
    {
      id: "mock10", subreddit: "investing", source: "hot", theme: null,
      title: "Why buying GOOG here — search moat underappreciated",
      body:  "GOOG at 18x earnings growing 15%. YouTube and cloud not priced in.",
      upvotes: 445, numComments: 167, createdUtc: now - 9000, url: "#", extractedTickers: [],
    },
  ];

  return {
    posts,
    themedBatches: [
      { theme: "AI",             query: "AI stocks earnings",            posts: posts.filter(p => p.theme === "AI") },
      { theme: "interest rates", query: "Fed rate decision stocks",      posts: posts.filter(p => p.theme === "interest rates") },
      { theme: "crypto",         query: "crypto stocks thesis Bitcoin",  posts: posts.filter(p => p.theme === "crypto") },
      { theme: "uranium",        query: "uranium nuclear energy stocks", posts: posts.filter(p => p.theme === "uranium") },
    ],
    meta: {
      timestamp:    Date.now(),
      durationMs:   0,
      totalPosts:   posts.length,
      hotPosts:     5,
      themePosts:   5,
      dedupedOut:   0,
      perSubreddit: { wallstreetbets: 4, stocks: 4, investing: 4 },
      themeSearch:  {
        queries: 4,
        posts:   5,
        themes:  ["AI", "interest rates", "crypto", "uranium"],
      },
    },
  };
}
