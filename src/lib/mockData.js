export const cards = [
  {
    ticker: "LLY",
    name: "Eli Lilly",
    tier: "S",
    score: 94,
    overview: "Dominant player in GLP-1 weight loss drugs with massive demand and limited supply. Pricing power and long-term healthcare tailwinds.",
    signals: {
      reddit: [
        { text: "Users discussing Ozempic shortages everywhere", confidence: "high" },
        { text: "Weight loss transformation posts exploding", confidence: "high" }
      ],
      tiktok: [
        { text: "#ozempic and #mounjaro trending heavily", confidence: "high" }
      ],
      news: [
        { text: "Insurance coverage expanding for weight loss drugs", confidence: "medium" }
      ]
    },
    financials: {
      revenueGrowth: "25%",
      margin: "31%",
      valuation: "High P/E"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0000059478",
      earnings: "https://www.youtube.com/results?search_query=LLY+earnings+call"
    }
  },

  {
    ticker: "NVDA",
    name: "NVIDIA",
    tier: "S",
    score: 96,
    overview: "AI infrastructure backbone with unmatched GPU demand. Data center growth driven by LLM arms race.",
    signals: {
      reddit: [
        { text: "Constant discussion around AI chips and demand", confidence: "high" }
      ],
      tiktok: [
        { text: "AI startups referencing NVIDIA constantly", confidence: "medium" }
      ],
      news: [
        { text: "Cloud providers increasing GPU capex", confidence: "high" }
      ]
    },
    financials: {
      revenueGrowth: "60%+",
      margin: "Extremely high",
      valuation: "Premium"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0001045810",
      earnings: "https://www.youtube.com/results?search_query=NVDA+earnings+call"
    }
  },

  {
    ticker: "COST",
    name: "Costco",
    tier: "A",
    score: 88,
    overview: "Loyal customer base and strong private label economics. Thrives in inflationary environments.",
    signals: {
      reddit: [
        { text: "Users bragging about bulk savings", confidence: "medium" }
      ],
      tiktok: [
        { text: "Costco haul videos trending", confidence: "high" }
      ],
      news: [
        { text: "Membership growth remains strong", confidence: "medium" }
      ]
    },
    financials: {
      revenueGrowth: "10%",
      margin: "Stable",
      valuation: "Premium"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0000909832",
      earnings: "https://www.youtube.com/results?search_query=Costco+earnings+call"
    }
  },

  {
    ticker: "DE",
    name: "Deere & Co",
    tier: "A",
    score: 85,
    overview: "Agricultural automation and precision farming leader benefiting from global food demand.",
    signals: {
      reddit: [
        { text: "Farmers discussing equipment upgrades", confidence: "low" }
      ],
      tiktok: [
        { text: "Tractor automation videos gaining traction", confidence: "medium" }
      ],
      news: [
        { text: "Precision agriculture adoption rising", confidence: "high" }
      ]
    },
    financials: {
      revenueGrowth: "12%",
      margin: "Strong",
      valuation: "Reasonable"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0000315189",
      earnings: "https://www.youtube.com/results?search_query=Deere+earnings+call"
    }
  },

  {
    ticker: "SPOT",
    name: "Spotify",
    tier: "B",
    score: 78,
    overview: "Leader in audio streaming with growing podcast ecosystem, but profitability still evolving.",
    signals: {
      reddit: [
        { text: "Users debating subscription value", confidence: "medium" }
      ],
      tiktok: [
        { text: "Podcast clips driving engagement", confidence: "high" }
      ],
      news: [
        { text: "Price increases being tested", confidence: "medium" }
      ]
    },
    financials: {
      revenueGrowth: "15%",
      margin: "Low",
      valuation: "Mixed"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0001639920",
      earnings: "https://www.youtube.com/results?search_query=Spotify+earnings+call"
    }
  },

  {
    ticker: "SBUX",
    name: "Starbucks",
    tier: "B",
    score: 75,
    overview: "Global brand with pricing power but facing slowing traffic and cultural fatigue.",
    signals: {
      reddit: [
        { text: "Complaints about pricing", confidence: "high" }
      ],
      tiktok: [
        { text: "Custom drink hacks still popular", confidence: "medium" }
      ],
      news: [
        { text: "Unionization and store traffic concerns", confidence: "medium" }
      ]
    },
    financials: {
      revenueGrowth: "8%",
      margin: "Moderate",
      valuation: "Full"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0000829224",
      earnings: "https://www.youtube.com/results?search_query=Starbucks+earnings+call"
    }
  },

  {
    ticker: "ROKU",
    name: "Roku",
    tier: "C",
    score: 68,
    overview: "Streaming platform with strong user base but weak monetization and ad dependency.",
    signals: {
      reddit: [
        { text: "Users like interface but complain about ads", confidence: "medium" }
      ],
      tiktok: [
        { text: "Streaming device comparisons trending", confidence: "low" }
      ],
      news: [
        { text: "Ad market volatility impacting revenue", confidence: "high" }
      ]
    },
    financials: {
      revenueGrowth: "5%",
      margin: "Negative",
      valuation: "Speculative"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0001428439",
      earnings: "https://www.youtube.com/results?search_query=Roku+earnings+call"
    }
  },

  {
    ticker: "PINS",
    name: "Pinterest",
    tier: "C",
    score: 66,
    overview: "Niche social platform with potential in shopping integration but inconsistent engagement.",
    signals: {
      reddit: [
        { text: "Users shifting to other platforms", confidence: "medium" }
      ],
      tiktok: [
        { text: "Less cultural relevance vs competitors", confidence: "high" }
      ],
      news: [
        { text: "E-commerce integrations improving", confidence: "medium" }
      ]
    },
    financials: {
      revenueGrowth: "7%",
      margin: "Improving",
      valuation: "Uncertain"
    },
    links: {
      edgar: "https://www.sec.gov/edgar/browse/?CIK=0001506293",
      earnings: "https://www.youtube.com/results?search_query=Pinterest+earnings+call"
    }
  }
];
