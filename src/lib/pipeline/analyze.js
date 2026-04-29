// /lib/pipeline/analyze.js
//
// Stage 7: AI critical thinking layer.
//
// Receives top-ranked tickers from the deterministic scoring stage.
// Claude's job: interpret WHAT is driving attention and WHY it matters.
//
// What Claude does NOT do:
//   - re-score tickers (scores are final from prioritize.js)
//   - re-rank tickers (order is final from prioritize.js)
//   - speculate beyond what the post data contains
//   - recommend buying or selling
//
// What Claude DOES do:
//   - identify the narrative driving each ticker's attention
//   - classify discussion type from post evidence
//   - surface catalysts or risks explicitly mentioned in posts
//   - flag when the data is insufficient to draw conclusions
//
// One API call per pipeline run. All tickers batched.
// Falls back to deterministic classification if API fails.

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the critical thinking layer for DraftBoard, an investment signal discovery system.

You receive pre-scored, pre-ranked ticker signals extracted from Reddit posts. The scores and rankings are already final — do not change them.

YOUR ONLY JOB: For each ticker, read the post evidence and answer three questions:
1. What narrative is driving this ticker's attention right now?
2. What type of discussion is it — thesis, news, or hype?
3. What is the key catalyst or risk explicitly mentioned in the posts?

SIGNAL TYPE DEFINITIONS (apply strictly):
- "thesis"  → posts contain reasoned investment argument: valuation, competitive position, structural trend, or management action. Must cite evidence.
- "news"    → posts are primarily reacting to a specific recent event: earnings, deal, regulatory action, product launch, macro data.
- "hype"    → posts contain conviction without evidence: emojis, price targets with no basis, "to the moon", coordinated language.
- "mixed"   → meaningful split between thesis/news and hype within the same ticker's posts.
- "unknown" → post evidence is too thin to classify (body too short, no context).

CONFIDENCE DEFINITIONS:
- "high"    → 3 posts available, consistent signal type, clear narrative identifiable.
- "medium"  → 2 posts, or posts from only one subreddit, or mixed signals.
- "low"     → 1 post, very short bodies, or contradictory signals.

RULES:
- Cite specific evidence from post titles or body previews. Do not invent.
- narrative_summary must be 1–2 sentences maximum. No filler phrases.
- key_catalyst: one sentence. If none is identifiable, write null.
- key_risk: one sentence citing post evidence. If none mentioned, write null.
- Do not recommend buying or selling.
- If you are uncertain, say so in narrative_summary rather than speculating.

OUTPUT: Return ONLY a valid JSON array. No markdown, no backticks, no preamble.

[
  {
    "ticker": "NVDA",
    "signal_type": "thesis",
    "confidence": "high",
    "narrative_summary": "Discussion centers on AI infrastructure capex as a multi-year structural driver, with posts citing hyperscaler spending acceleration and NVDA's data center segment.",
    "key_catalyst": "Hyperscaler capex guidance and SMCI liquid cooling partnership mentioned across posts.",
    "key_risk": null
  }
]`;

// ─── Input formatter ──────────────────────────────────────────────────────────

/**
 * Format a RankedTicker into a compact evidence block for the prompt.
 * Keeps the payload small — Claude only needs what's in the posts.
 *
 * @param {RankedTicker} signal
 * @returns {string}
 */
function formatSignalForPrompt(signal) {
  const posts = (signal.samplePosts ?? []).map((p, i) => {
    const age    = Math.round((Date.now() / 1000 - p.createdUtc) / 3600);
    const body   = p.bodyPreview?.trim() || "(no body)";
    const source = p.theme ? `r/${p.subreddit} via theme:${p.theme}` : `r/${p.subreddit}`;
    return (
      `  Post ${i + 1} [${source}, ↑${p.upvotes}, ${p.numComments} comments, ${age}h ago]:\n` +
      `    Title: "${p.title}"\n` +
      `    Body:  "${body}"`
    );
  }).join("\n");

  return (
    `TICKER: ${signal.ticker}\n` +
    `Score: ${signal.finalScore} | Mentions: ${signal.mentions} | Velocity: ${signal.velocity}\n` +
    `Penalty: ${signal.penaltyAdjustment < 0 ? signal.penaltyAdjustment + " (flagged)" : "none"}\n` +
    `Posts:\n${posts || "  (no posts available)"}`
  );
}

// ─── Deterministic fallback classifier ───────────────────────────────────────
//
// Used when the API call fails. Deterministic only.
// Based on structural signals already computed by prioritize.js.

/**
 * @param {RankedTicker} signal
 * @returns {TickerAnalysis}
 */
function deterministicAnalysis(signal) {
  const penalty    = signal.penaltyAdjustment ?? 0;
  const quality    = signal.qualityScore      ?? 50;
  const consistency = signal.consistencyScore ?? 50;

  // Classify by scoring dimensions
  let signalType;
  let narrative;
  let confidence;

  if (penalty <= -15) {
    signalType = "hype";
    narrative  = "High penalty score indicates spike pattern or low-quality posts. Structural signals suggest hype rather than substantive discussion.";
    confidence = "low";
  } else if (quality >= 65 && consistency >= 60) {
    signalType = "thesis";
    narrative  = `Quality and consistency scores are strong (quality: ${quality}, consistency: ${consistency}). Posts likely contain substantive content.`;
    confidence = "medium";
  } else if (quality < 40) {
    signalType = "hype";
    narrative  = `Low quality score (${quality}) indicates thin post content. Attention may not be thesis-driven.`;
    confidence = "medium";
  } else {
    signalType = "unknown";
    narrative  = "Insufficient structural signal to classify discussion type without reading post content.";
    confidence = "low";
  }

  return {
    ticker:            signal.ticker,
    signal_type:       signalType,
    confidence,
    narrative_summary: narrative,
    key_catalyst:      null,
    key_risk:          null,
    source:            "deterministic_fallback",
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run AI analysis on top-ranked signals.
 * Returns one TickerAnalysis per signal, in the same order.
 *
 * @param {RankedTicker[]} signals    — from prioritizeSignals(), top N only
 * @param {object}         options
 * @param {number}         options.topN       — how many tickers to analyze (default 10)
 * @param {number}         options.timeoutMs  — API timeout in ms (default 12000)
 * @returns {Promise<TickerAnalysis[]>}
 */
export async function analyzeSignals(signals, {
  topN      = 10,
  timeoutMs = 12_000,
} = {}) {
  if (!signals || signals.length === 0) return [];

  const targets = signals.slice(0, topN);

  // ── Build prompt ───────────────────────────────────────────────────────────

  const evidenceBlocks = targets.map(formatSignalForPrompt).join("\n\n---\n\n");

  const userMessage =
    `Analyze these ${targets.length} ticker signals from the current pipeline run.\n\n` +
    `For each ticker, read the post evidence and classify the discussion.\n\n` +
    `${evidenceBlocks}\n\n` +
    `Return the JSON array now. One object per ticker, in the same order. Be concise and cite evidence.`;

  // ── API call ───────────────────────────────────────────────────────────────

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
        system:     SYSTEM_PROMPT,
        messages:   [{ role: "user", content: userMessage }],
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`API ${res.status}: ${err?.error?.message ?? "unknown"}`);
    }

    const data = await res.json();
    const raw  = data.content.map(b => b.text || "").join("");

    // Strip markdown fencing and parse
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array in response");

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error("Response is not an array");

    // Validate and normalize each entry
    const validated = parsed.map((entry, i) => {
      const fallback = deterministicAnalysis(targets[i] ?? targets[0]);
      return {
        ticker:            entry.ticker            ?? targets[i]?.ticker ?? "?",
        signal_type:       VALID_SIGNAL_TYPES.has(entry.signal_type) ? entry.signal_type : fallback.signal_type,
        confidence:        VALID_CONFIDENCE.has(entry.confidence)    ? entry.confidence  : fallback.confidence,
        narrative_summary: typeof entry.narrative_summary === "string" && entry.narrative_summary.length > 0
          ? entry.narrative_summary
          : fallback.narrative_summary,
        key_catalyst:      entry.key_catalyst ?? null,
        key_risk:          entry.key_risk     ?? null,
        source:            "claude",
      };
    });

    // Ensure we have one result per input ticker
    // If Claude returned fewer results than expected, pad with fallbacks
    if (validated.length < targets.length) {
      const returned = new Set(validated.map(v => v.ticker));
      for (const sig of targets) {
        if (!returned.has(sig.ticker)) {
          validated.push({ ...deterministicAnalysis(sig), source: "claude_missing_fallback" });
        }
      }
    }

    return validated;

  } catch (err) {
    console.warn(`[analyze] AI analysis failed (${err.message}), using deterministic fallback`);
    return targets.map(s => ({ ...deterministicAnalysis(s), source: "deterministic_fallback" }));
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_SIGNAL_TYPES = new Set(["thesis", "news", "hype", "mixed", "unknown"]);
const VALID_CONFIDENCE   = new Set(["high", "medium", "low"]);

/**
 * Merge analysis results back into the signal array.
 * Adds an `analysis` field to each RankedTicker.
 *
 * @param {RankedTicker[]}   signals
 * @param {TickerAnalysis[]} analyses
 * @returns {RankedTicker[]} — same order, with .analysis attached
 */
export function mergeAnalysis(signals, analyses) {
  const byTicker = new Map(analyses.map(a => [a.ticker, a]));
  return signals.map(signal => ({
    ...signal,
    analysis: byTicker.get(signal.ticker) ?? null,
  }));
}
