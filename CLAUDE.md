@AGENTS.md

# DraftBoard — System Limitations (V1 Freeze)

This document records the known limitations of DraftBoard as evaluated in the
May 2026 senior system audit. These are not bugs. They are properties of the
data source and architecture that cannot be engineered away without changing
what the system fundamentally does.

## What DraftBoard actually does

DraftBoard monitors a fixed set of subreddits for discussion of predefined
investment themes, extracts ticker mentions, scores them on discussion-quality
heuristics, and surfaces the most consistently-discussed, highest-quality-proxy
candidates with AI-generated narrative labels.

**Honest framing:** a structured, scored, explainable feed of retail investment
discussion activity.

## What DraftBoard does not do

- **It does not discover novel signals.** It finds what it was told to look for,
  in public forums. Tickers that nobody is discussing will never surface.

- **It does not measure signal quality in the investment sense.** It measures
  structural proxies for discussion quality: body length, engagement ratio,
  subreddit spread. A 600-char post with unsupported price predictions scores
  higher than a 50-char post with a precise thesis.

- **It does not validate whether signals were correct.** The evaluation engine
  (`evaluate.js`) measures whether tickers continued to be discussed — not
  whether the thesis proved out.

- **It is systematically biased toward high-beta, well-known names.** SPY, GME,
  NVDA, TSLA, and MSTR will always surface. They are always discussed. The
  velocity model cannot distinguish "genuinely new signal" from "always talked
  about." This is a property of the data source, not a bug to fix.

## Known correctness risks

**Ring buffer desync (evaluate.js):**
Signal records reference snapshots that may be purged before the 72h evaluation
window runs. `evaluate.js` now guards against this — results with fewer than 3
available snapshots are forced to "inconclusive" rather than "noise." `snapshotStore.js`
MAX_SNAPSHOTS = 200 reduces but does not eliminate the risk.

**AI analysis on truncated input (analyze.js):**
Claude receives up to 400 chars of post body. On posts with lengthy context-
setting openers, the argumentative content may not appear in the preview. Claude
will return "unknown" or "low confidence" classifications on these. This is
correct behavior — the system should not claim certainty it does not have.

**API timeout downranking (shortlist.js):**
Previously, Claude API timeouts caused all signals in that run to be downranked
by rule S3. This has been fixed: `claude_timeout_fallback` source bypasses S3.
Intentional skips (`deterministic_fallback`) still apply the penalty.

## V1 freeze — do not change without evaluation data

- Base weights (mentions 0.40, velocity 0.35, theme 0.25)
- Quality gate threshold (adjusted score ≥ 35)
- Evaluation outcome thresholds (confirmed: ratio ≥ 0.75, 3+ snapshots, 50% consistency)
- Shortlist rule hierarchy (H1–H4, S1–S5, G1, CAP)
- Immutable snapshot design (SHA-256 ID)
- Append-only store design
- Human-gated feedback loop

## Useful for

- Staying current with retail sentiment on names you already have a view on
- Catching emerging attention around specific themes before it peaks
- First-pass filtering before doing primary research
- Understanding what the retail conversation looks like right now

## Not useful for

- Finding things nobody else has found
- Validating investment theses
- Generating alpha from information asymmetry
