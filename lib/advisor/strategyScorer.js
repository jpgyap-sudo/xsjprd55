export function scoreLongShort(context) {
  let longScore = 0.5;
  let shortScore = 0.5;
  const reasons = [];
  const warnings = [];

  const trend = context.market?.trend;
  if (trend === 'up') {
    longScore += 0.15;
    shortScore -= 0.10;
    reasons.push('Trend favors long continuation.');
  } else if (trend === 'down') {
    shortScore += 0.15;
    longScore -= 0.10;
    reasons.push('Trend favors short continuation.');
  }

  const liqBias = context.derivatives?.liquidation_bias;
  if (liqBias === 'upside_sweep') {
    longScore += 0.10;
    reasons.push('Liquidation map suggests possible upside sweep.');
  } else if (liqBias === 'downside_sweep') {
    shortScore += 0.10;
    reasons.push('Liquidation map suggests possible downside sweep.');
  }

  if (context.derivatives?.funding && Number(context.derivatives.funding) > 0.05) {
    warnings.push('Funding appears crowded on longs; avoid over-leverage.');
    longScore -= 0.05;
  }

  if (context.data_health?.fresh === false) {
    warnings.push('Data is stale; recommendation confidence reduced.');
    longScore -= 0.15;
    shortScore -= 0.15;
  }

  longScore = clamp(longScore);
  shortScore = clamp(shortScore);

  let bias = 'neutral';
  let confidence = Math.max(longScore, shortScore);
  if (confidence < Number(process.env.ADVISOR_MIN_CONFIDENCE || 0.55)) bias = 'neutral';
  else bias = longScore > shortScore ? 'long' : 'short';

  return { bias, confidence, longScore, shortScore, reasons, warnings };
}

function clamp(n) {
  return Math.max(0, Math.min(1, Number(n.toFixed(4))));
}
