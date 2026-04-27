// ============================================================
// Liquidation Heatmap Engine
// Estimates probable price direction from liquidation clusters,
// open-interest trend, and funding rate.
// ============================================================

/**
 * Estimate probable price direction from liquidation data.
 * @param {Object} opts
 * @param {number} opts.currentPrice
 * @param {Array<{price:number, estimatedVolume:number}>} opts.longLiquidations
 * @param {Array<{price:number, estimatedVolume:number}>} opts.shortLiquidations
 * @param {string} opts.oiTrend   'rising' | 'falling' | 'flat'
 * @param {number} opts.fundingRate
 */
export function estimateProbableDirection({
  currentPrice = 0,
  longLiquidations = [],
  shortLiquidations = [],
  oiTrend = 'flat',
  fundingRate = 0,
}) {
  const longVolume = longLiquidations.reduce((sum, l) => sum + Number(l.estimatedVolume || 0), 0);
  const shortVolume = shortLiquidations.reduce((sum, l) => sum + Number(l.estimatedVolume || 0), 0);

  let direction = 'NEUTRAL';
  let confidence = 50;
  const reasons = [];

  if (shortVolume > longVolume * 1.25) {
    direction = 'UP';
    confidence += 10;
    reasons.push('Larger short liquidation cluster above price may attract upside move.');
  }

  if (longVolume > shortVolume * 1.25) {
    direction = 'DOWN';
    confidence += 10;
    reasons.push('Larger long liquidation cluster below price may attract downside move.');
  }

  if (oiTrend === 'rising') {
    confidence += 5;
    reasons.push('Open interest is rising, increasing squeeze risk.');
  }

  if (fundingRate > 0.03) {
    reasons.push('Positive funding suggests crowded longs and downside squeeze risk.');
  }

  if (fundingRate < -0.03) {
    reasons.push('Negative funding suggests crowded shorts and upside squeeze risk.');
  }

  if (longVolume > 0 && shortVolume > 0 && Math.abs(longVolume - shortVolume) / Math.max(longVolume, shortVolume) < 0.2) {
    direction = 'VOLATILE_TWO_SIDED';
    confidence = Math.max(confidence, 60);
    reasons.push('Large clusters exist on both sides. Avoid high leverage.');
  }

  return {
    probableDirection: direction,
    confidence: Math.min(confidence, 85),
    reasons,
    longVolume,
    shortVolume,
  };
}

/**
 * Build heatmap response shape for API.
 */
export function buildHeatmapResponse({
  symbol,
  currentPrice,
  longLiquidations,
  shortLiquidations,
  probableDirection,
  confidence,
  dataSource = 'unknown',
  fallbackUsed = false,
}) {
  return {
    symbol,
    currentPrice,
    probableDirection,
    confidence,
    longLiquidations: longLiquidations.map(l => ({ price: l.price, estimatedVolume: l.estimatedVolume })),
    shortLiquidations: shortLiquidations.map(l => ({ price: l.price, estimatedVolume: l.estimatedVolume })),
    dataSource,
    fallbackUsed,
    generated_at: new Date().toISOString(),
  };
}
