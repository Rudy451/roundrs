// /lib/pipeline/aiThemeExpander.js
//
// AI-powered theme expansion using Claude.
// Generates high-signal, Reddit-optimized search queries from abstract themes.
//
// Strategy:
//   - Sends all themes in ONE API call (batch efficiency)
//   - Applies financial context, catalyst framing, real-world anchors
//   - Optimizes for Reddit discussion retrieval, not SEO
//   - Falls back gracefully if API is unavailable

const EXPANSION_SYSTEM_PROMPT = `You are a financial research query generator for a Reddit-based investment discovery system called DraftBoard.

Your job: convert abstract market themes into high-signal Reddit search queries that surface investor discussion, emerging narratives, catalysts, and bull/bear debates.

RULES:
1. 2–5 queries per theme (aim for 4 when possible)
2. Each query must be financially specific — never generic single words
3. Layer in: financial context (stocks, earnings, ETFs), catalysts (earnings, regulation, demand, supply, breakout), real-world tickers when highly relevant
4. Optimize for Reddit discussion retrieval — conversational, not SEO-style
5. Include at least one contrarian/bear-case query per theme (e.g. "bubble", "overcrowded", "headwinds") to surface disagreement
6. Vary phrasing across queries — avoid repeating the same words

OUTPUT: Return ONLY valid JSON. No markdown, no explanation, no backticks.

[
  {
    "theme": "AI",
    "queries": [
      "AI stocks earnings catalyst",
      "Nvidia AMD semiconductor AI demand",
      "AI infrastructure capex bubble",
      "AI ETF undervalued plays"
    ]
  }
]`;

/**
 * Expand themes into targeted Reddit search queries using Claude.
 * Sends all themes in a single API call for efficiency.
 *
 * @param {string[]} themes  e.g. ["AI", "oil", "interest rates", "crypto"]
 * @param {object}   options
 * @param {number}   options.queriesPerTheme  - target queries per theme (default 4)
 * @param {number}   options.timeoutMs        - API call timeout (default 10000)
 * @returns {Promise<Array<{ theme: string, queries: string[], source: "ai"|"fallback" }>>}
 */
export async function expandThemesWithAI(themes, {
  queriesPerTheme = 4,
  timeoutMs       = 10_000,
} = {}) {
  if (!themes || themes.length === 0) return [];

  const userPrompt = `Expand these ${themes.length} investment themes into ${queriesPerTheme} high-signal Reddit search queries each.

Themes: ${themes.map(t => `"${t}"`).join(", ")}

For each theme apply:
- Financial context (stocks, earnings, ETF, thesis, valuation)
- Catalyst framing (earnings, demand, supply, regulation, catalyst, breakout)
- Real-world tickers where highly relevant (e.g. NVDA for AI, CVX for oil)
- At least one contrarian query (bubble, headwinds, overcrowded, bear case)
- Varied phrasing — no repeated words across queries

Return the JSON array now.`;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system:     EXPANSION_SYSTEM_PROMPT,
        messages:   [{ role: "user", content: userPrompt }],
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data  = await res.json();
    const raw   = data.content.map(b => b.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);

    if (!match) throw new Error("No JSON array in response");

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error("Response not an array");

    // Validate + normalise each entry
    return parsed.map(entry => ({
      theme:   entry.theme   || "unknown",
      queries: Array.isArray(entry.queries)
        ? entry.queries
            .filter(q => typeof q === "string" && q.trim().length > 3)
            .slice(0, 5)   // hard cap
        : [],
      source: "ai",
    }));

  } catch (err) {
    console.warn("[aiThemeExpander] AI expansion failed:", err.message, "— using fallback");
    return null; // Signal to caller to use static fallback
  }
}

/**
 * Expand a single theme using AI (convenience wrapper).
 * Used when you need to expand one theme ad-hoc without a full batch.
 *
 * @param {string} theme
 * @returns {Promise<{ theme: string, queries: string[], source: string }>}
 */
export async function expandSingleTheme(theme) {
  const results = await expandThemesWithAI([theme]);
  return results?.[0] ?? null;
}
