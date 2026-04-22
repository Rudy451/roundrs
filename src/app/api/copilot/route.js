const ALERT_PROMPTS = {
  valuation_mismatch: ({ ticker, decision, noteSummary }) =>
    `Ticker: ${ticker}\nDecision: ${decision}\nIssue: High conviction despite weak valuation\nNotes: ${noteSummary || "None"}\n\nExplain this contradiction and what risks it introduces. Be concise and structured.`,

  hype_risk: ({ ticker, decision, noteSummary }) =>
    `Ticker: ${ticker}\nDecision: ${decision}\nIssue: Sentiment may be outpacing fundamentals\nNotes: ${noteSummary || "None"}\n\nWhat is the downside risk if sentiment reverses? Be concise and structured.`,

  no_notes: ({ ticker, decision }) =>
    `Ticker: ${ticker}\nDecision: ${decision}\nIssue: No notes supporting this decision\n\nWhat key questions should an investor answer before committing to this decision? Be concise, 3-4 bullet points.`,

  weak_signals: ({ ticker, decision, noteSummary }) =>
    `Ticker: ${ticker}\nDecision: ${decision}\nIssue: Weak momentum and weak growth\nNotes: ${noteSummary || "None"}\n\nIs there a plausible bull case here, or should this be reconsidered? Be direct and structured.`,
};

export async function POST(req) {
  try {
    const { ticker, decision, alert, noteSummary } = await req.json();

    if (!ticker || !alert) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const buildPrompt = ALERT_PROMPTS[alert];
    if (!buildPrompt) {
      return Response.json({ error: "Unknown alert key" }, { status: 400 });
    }

    const userPrompt = buildPrompt({ ticker, decision, noteSummary });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: "You are a disciplined investment analyst. Be concise, structured, and direct. No disclaimers. No preamble.",
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return Response.json({ error: "LLM request failed", detail: err }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "No response.";

    return Response.json({ result: text });
  } catch (err) {
    return Response.json({ error: "Internal error", detail: err.message }, { status: 500 });
  }
}
