/**
 * Compute attention + crowding scores for an array (or object map) of ticker stats.
 *
 * @param {Array|Object} stats — output of extractTickerMentions / applyVelocity
 * @returns {Array} enriched stats with attentionScore and crowding
 */
export function computeAttentionScore(stats) {
  const arr = Array.isArray(stats) ? stats : Object.values(stats);

  return arr.map(s => {
    const raw       = s.mentions * 1.0 + s.velocity * 1.5;
    const attention = Math.round(Math.min(100, Math.max(0, raw)));
    const crowding  = Math.round(Math.min(100, s.mentions));

    return { ...s, attentionScore: attention, crowding };
  });
}

/**
 * Apply attention signals to adjust a conviction score.
 * Keeps logic deterministic and cost-free.
 *
 * @param {number} conviction — base conviction score
 * @param {{ attentionScore: number, crowding: number }} attentionData
 * @param {{ growth?: number }} fundamentals
 * @returns {number} adjusted conviction (clamped 0–100)
 */
export function applyAttentionToConviction(conviction, attentionData, fundamentals) {
  let adjusted = conviction;

  if (attentionData.attentionScore > 80 && (fundamentals?.growth ?? 0) > 70) {
    adjusted += 5;
  }

  if (attentionData.crowding > 80) {
    adjusted -= 10;
  }

  return Math.round(Math.max(0, Math.min(100, adjusted)));
}
