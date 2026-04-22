export function getSignalAlignment(signals, fundamentals) {
  let score = 50;

  // Sentiment + growth alignment
  if (signals?.sentiment > 70 && fundamentals?.growth > 70) score += 30;
  if (signals?.sentiment < 40 && fundamentals?.growth < 40) score -= 20;
  if (signals?.sentiment > 80 && fundamentals?.growth < 50) score -= 15;

  // Attention signal bonuses/penalties (if present)
  if (signals?.attention != null) {
    if (signals.attention > 80 && (fundamentals?.growth ?? 0) > 70) score += 5;
    if (signals.crowding  > 80) score -= 10;
    if (signals.velocity  > 20) score += 3;   // fast-rising narrative
    if (signals.velocity  < -20) score -= 5;  // fading narrative
  }

  return Math.max(0, Math.min(100, score));
}

export function getFundamentalStrength(fundamentals) {
  if (!fundamentals) return 50;
  const { growth = 50, margins = 50, revenue = 50 } = fundamentals;
  return (growth * 0.5) + (margins * 0.3) + (revenue * 0.2);
}

export function getValuationSupport(fundamentals) {
  return fundamentals?.valuation ?? 50;
}

export function getNotesQuality(note) {
  if (!note) return 0;
  const lengthScore = Math.min(note.length / 2, 60);
  const keywordBonus =
    (note.toLowerCase().includes("risk")       ? 10 : 0) +
    (note.toLowerCase().includes("growth")     ? 10 : 0) +
    (note.toLowerCase().includes("valuation")  ? 10 : 0);
  return Math.min(100, lengthScore + keywordBonus);
}

export function getDecisionConsistency(decision, fundamentals) {
  if (!decision || !fundamentals) return 50;
  if (decision === "ADD"  && fundamentals.valuation < 40) return 40;
  if (decision === "ADD"  && fundamentals.growth > 70)    return 90;
  if (decision === "PASS" && fundamentals.growth > 80)    return 30;
  return 70;
}

export function getConvictionScore(card, note, decision) {
  const signalAlignment     = getSignalAlignment(card.signals, card.fundamentals);
  const fundamentalStrength = getFundamentalStrength(card.fundamentals);
  const valuationSupport    = getValuationSupport(card.fundamentals);
  const notesQuality        = getNotesQuality(note);
  const decisionConsistency = getDecisionConsistency(decision, card.fundamentals);

  const score =
    (signalAlignment     * 0.30) +
    (fundamentalStrength * 0.25) +
    (valuationSupport    * 0.20) +
    (notesQuality        * 0.15) +
    (decisionConsistency * 0.10);

  return Math.round(score);
}
