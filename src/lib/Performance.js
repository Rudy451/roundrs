export function getReturn(entry, current) {
  if (!entry || !current) return 0;
  return ((current - entry) / entry) * 100;
}

export function getConvictionAccuracy(conviction, returnPct) {
  if (conviction >= 80 && returnPct > 0)  return "correct";
  if (conviction >= 80 && returnPct < 0)  return "overconfident";
  if (conviction < 60  && returnPct > 0)  return "underconfident";
  return "neutral";
}

export function getSystemScore(positions) {
  let score = 0;
  positions.forEach(p => {
    const ret = getReturn(p.entryPrice, p.currentPrice);
    if (p.convictionAtEntry >= 75 && ret > 0) score += 2;
    if (p.convictionAtEntry >= 75 && ret < 0) score -= 2;
    if (p.convictionAtEntry < 60  && ret > 0) score -= 1;
  });
  return score;
}

// Summary helpers consumed by the UI
export function getPortfolioStats(positions) {
  const active = positions.filter(p => p.currentPrice);
  if (!active.length) return { avgReturn: 0, winRate: 0, systemScore: 0 };

  const returns   = active.map(p => getReturn(p.entryPrice, p.currentPrice));
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const winRate   = (returns.filter(r => r > 0).length / returns.length) * 100;
  const systemScore = getSystemScore(active);

  return {
    avgReturn:   Math.round(avgReturn * 10) / 10,
    winRate:     Math.round(winRate),
    systemScore,
  };
}
