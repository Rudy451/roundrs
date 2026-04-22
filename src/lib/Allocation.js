function getBaseAllocation(conviction) {
  if (conviction >= 85) return 0.10;
  if (conviction >= 75) return 0.07;
  if (conviction >= 65) return 0.05;
  if (conviction >= 50) return 0.03;
  return 0.01;
}

function adjustForDecision(base, decision) {
  if (decision === "ADD")   return base;
  if (decision === "WATCH") return base * 0.5;
  if (decision === "PASS")  return 0;
  if (decision === "KILL")  return 0;
  return base;
}

function adjustForRisk(base, alerts) {
  let penalty = 0;
  alerts.forEach(alert => {
    if (alert.type === "risk")    penalty += 0.02;
    if (alert.type === "warning") penalty += 0.01;
  });
  return Math.max(0, base - penalty);
}

export function getPositionSize(card, conviction, decision, alerts = []) {
  let base = getBaseAllocation(conviction);
  base = adjustForDecision(base, decision);
  base = adjustForRisk(base, alerts);
  base = Math.min(base, 0.10);
  return Math.round(base * 100);
}
