export function buildAdvisorReport({ context, score, risk }) {
  const price = context.market?.price;
  const bias = risk.bias;

  return {
    symbol: context.symbol,
    timeframe: context.timeframe,
    horizon: context.horizon,
    bias,
    confidence: score.confidence,
    risk_score: risk.riskScore,
    entry_zone: estimateEntryZone(price, bias),
    stop_loss: estimateStop(price, bias),
    take_profits: estimateTakeProfits(price, bias),
    invalidation_price: estimateStop(price, bias),
    reasons: score.reasons || [],
    warnings: risk.warnings || [],
    strategy: {
      name: 'AI Consultant Composite',
      advisor_only: true,
      execution_allowed: false,
      notes: 'Uses market context, derivatives, sentiment, backtest memory, and risk gate.'
    },
    data_snapshot: context,
    model_used: process.env.BRAIN_AI_PROVIDER || 'local',
    disclaimer: 'Advisor only. Not financial advice. Manual decision required. No automatic trading.'
  };
}

function estimateEntryZone(price, bias) {
  if (!price || bias === 'neutral' || bias === 'avoid') return {};
  const p = Number(price);
  return bias === 'long'
    ? { from: round(p * 0.995), to: round(p * 1.002) }
    : { from: round(p * 0.998), to: round(p * 1.005) };
}

function estimateStop(price, bias) {
  if (!price || bias === 'neutral' || bias === 'avoid') return null;
  const p = Number(price);
  return bias === 'long' ? round(p * 0.985) : round(p * 1.015);
}

function estimateTakeProfits(price, bias) {
  if (!price || bias === 'neutral' || bias === 'avoid') return [];
  const p = Number(price);
  return bias === 'long'
    ? [round(p * 1.015), round(p * 1.03)]
    : [round(p * 0.985), round(p * 0.97)];
}

function round(n) {
  return Number(n.toFixed(6));
}
