// ============================================================
// Probability Engine — 6-Factor Scoring
// Combines market structure, liquidation, social, funding/OI,
// liquidity, and strategy history into a single probability.
// ============================================================

const DEFAULT_WEIGHTS = {
  market: 0.30,
  liquidation: 0.20,
  social: 0.15,
  fundingOi: 0.15,
  liquidity: 0.10,
  strategyHistory: 0.10,
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function confidenceFromProbability(probability, sampleSize = 0, quality = 70) {
  if (quality < 40) return 'low_data_quality';
  if (sampleSize < 20 && probability >= 65) return 'experimental';
  if (probability >= 70 && sampleSize >= 50) return 'strong';
  if (probability >= 62) return 'medium_high';
  if (probability >= 55) return 'medium';
  if (probability >= 50) return 'weak';
  return 'avoid';
}

/**
 * Calculate multi-factor probability score.
 * @param {Object} scores   { market, liquidation, social, fundingOi, liquidity, strategyHistory }
 * @param {Object} options  { weights, dataQuality, sampleSize }
 */
export function calculateProbability(scores = {}, options = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const normalized = {
    market: clamp(scores.market),
    liquidation: clamp(scores.liquidation),
    social: clamp(scores.social),
    fundingOi: clamp(scores.fundingOi),
    liquidity: clamp(scores.liquidity),
    strategyHistory: clamp(scores.strategyHistory),
  };

  const finalProbability = Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + normalized[key] * weight;
  }, 0);

  const dataQuality = clamp(options.dataQuality || 70);
  const sampleSize = Number(options.sampleSize || 0);

  return {
    finalProbability: Number(finalProbability.toFixed(2)),
    confidence: confidenceFromProbability(finalProbability, sampleSize, dataQuality),
    scores: normalized,
    weights,
    sampleSize,
    dataQuality,
  };
}
