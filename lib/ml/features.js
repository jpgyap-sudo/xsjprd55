export const FEATURE_NAMES = [
  'rule_probability', 'funding_rate', 'open_interest_change_pct',
  'liquidation_imbalance', 'log_total_liquidations', 'volume_change_pct',
  'volatility_pct', 'social_sentiment', 'news_sentiment',
  'btc_trend_score', 'whale_flow_score', 'spread_bps', 'side_long',
  'ema_cross_score', 'rsi_divergence', 'support_resistance_score',
  'macro_score', 'btc_dominance_score', 'order_book_depth',
];

export function buildFeatures(input) {
  const safe = (v) => (Number.isFinite(v) ? v : 0);
  const logLiq = (input.totalLiquidationsUsd || 0) > 0
    ? Math.log10(input.totalLiquidationsUsd + 1)
    : 0;
  return {
    rule_probability: safe(input.ruleProbability ?? 0.5),
    funding_rate: safe(input.fundingRate ?? 0),
    open_interest_change_pct: safe(input.openInterestChangePct ?? 0),
    liquidation_imbalance: safe(input.liquidationImbalance ?? 0),
    log_total_liquidations: safe(logLiq),
    volume_change_pct: safe(input.volumeChangePct ?? 0),
    volatility_pct: safe(input.volatilityPct ?? 1.5),
    social_sentiment: safe(input.socialSentiment ?? 0),
    news_sentiment: safe(input.newsSentiment ?? 0),
    btc_trend_score: safe(input.btcTrendScore ?? 0),
    whale_flow_score: safe(input.whaleFlowScore ?? 0),
    spread_bps: safe(input.spreadBps ?? 10),
    side_long: input.side === 'LONG' ? 1 : 0,
    // Technical indicator features computed from OHLCV data
    ema_cross_score: safe(input.emaCrossScore ?? 0),
    rsi_divergence: safe(input.rsiDivergence ?? 0.5),
    support_resistance_score: safe(input.supportResistanceScore ?? 0.5),
    macro_score: safe(input.macroScore ?? 0.5),
    btc_dominance_score: safe(input.btcDominanceScore ?? 0.5),
    order_book_depth: safe(input.orderBookDepth ?? 0.5),
  };
}

export function vectorize(features) {
  return FEATURE_NAMES.map((name) => {
    const v = features[name];
    return Number.isFinite(v) ? v : 0;
  });
}
