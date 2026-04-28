// ============================================================
// Probability / Confidence Scoring Engine
// Combines technical, backtest, liquidation, OI/funding, news/social
// into a single adjusted confidence score and recommendation.
// ============================================================

/**
 * Calculate raw confidence from individual component scores.
 * @param {Object} scores
 * @param {number} scores.technical   0-100
 * @param {number} scores.backtest    0-100
 * @param {number} scores.liquidation 0-100
 * @param {number} scores.oiFunding   0-100
 * @param {number} scores.newsSocial  0-100
 */
export function calculateRawConfidence(scores) {
  return (
    (scores.technical || 0) * 0.25 +
    (scores.backtest || 0) * 0.25 +
    (scores.liquidation || 0) * 0.20 +
    (scores.oiFunding || 0) * 0.15 +
    (scores.newsSocial || 0) * 0.15
  );
}

/**
 * Adjust confidence by data reliability (0-100).
 * Low reliability drags the effective confidence down.
 */
export function calculateAdjustedConfidence(rawConfidence, dataReliabilityScore) {
  return rawConfidence * (dataReliabilityScore || 100) / 100;
}

/**
 * Generate a human-readable recommendation.
 */
export function getSignalRecommendation(adjustedConfidence, dataReliabilityScore, bias) {
  if (dataReliabilityScore < 40) return 'Data incomplete. Avoid aggressive trading.';
  if (dataReliabilityScore < 60) return 'Weak data reliability. Use warning only, not a trade signal.';
  if (adjustedConfidence >= 75) return `Strong ${bias} setup, but still use strict risk control.`;
  if (adjustedConfidence >= 60) return `Tradable ${bias} setup with risk control.`;
  if (adjustedConfidence >= 50) return 'Weak edge. Wait for confirmation.';
  return 'Avoid. No strong edge.';
}

/**
 * Full analysis pipeline — computes bias, confidence, and recommendation.
 */
export function analyzeProbability({
  scores = {},
  dataReliabilityScore = 70,
  currentPrice = null,
  longLiquidations = [],
  shortLiquidations = [],
  oiTrend = 'flat',
  fundingRate = 0,
} = {}) {
  // Auto-compute liquidation score from engine if available
  let liquidationScore = scores.liquidation ?? 50;

  const rawConfidence = calculateRawConfidence({
    technical: scores.technical ?? 50,
    backtest: scores.backtest ?? 50,
    liquidation: liquidationScore,
    oiFunding: scores.oiFunding ?? 50,
    newsSocial: scores.newsSocial ?? 50,
  });

  const adjustedConfidence = calculateAdjustedConfidence(rawConfidence, dataReliabilityScore);

  // Determine bias
  let bias = 'NEUTRAL';
  if (adjustedConfidence >= 55) {
    // Use liquidation direction hint
    const longVol = longLiquidations.reduce((s, l) => s + Number(l.estimatedVolume || 0), 0);
    const shortVol = shortLiquidations.reduce((s, l) => s + Number(l.estimatedVolume || 0), 0);
    if (shortVol > longVol * 1.25) bias = 'LONG';
    else if (longVol > shortVol * 1.25) bias = 'SHORT';
    else bias = oiTrend === 'rising' && fundingRate > 0.01 ? 'SHORT' : 'LONG';
  }

  const recommendation = getSignalRecommendation(adjustedConfidence, dataReliabilityScore, bias);

  return {
    bias,
    rawConfidence: parseFloat(rawConfidence.toFixed(2)),
    adjustedConfidence: parseFloat(adjustedConfidence.toFixed(2)),
    dataReliabilityScore,
    recommendation,
    scores: {
      technical: scores.technical ?? 50,
      backtest: scores.backtest ?? 50,
      liquidation: liquidationScore,
      oiFunding: scores.oiFunding ?? 50,
      newsSocial: scores.newsSocial ?? 50,
    },
    riskWarning: dataReliabilityScore < 60 ? 'Low data reliability — reduce position size.' : undefined,
  };
}
