// ============================================================
// Strategy Scorer — Scores a trading signal based on market
// context, liquidation bias, and news sentiment.
// ============================================================

export async function scoreStrategy(context) {
  const { market, liquidation, news } = context;

  // Base score from market indicators (0-1)
  const emaScore = market?.ema_score ?? 0.5;
  const rsiScore = market?.rsi_score ?? 0.5;
  const volumeScore = market?.volume_score ?? 0.5;

  // Liquidation bias (-1 to 1, positive = bullish)
  const liqBias = liquidation?.bias ?? 0;

  // News sentiment (-1 to 1, positive = bullish)
  const newsSentiment = news?.sentiment ?? 0;

  // Composite score: weighted average
  const composite =
    emaScore * 0.30 +
    rsiScore * 0.25 +
    volumeScore * 0.15 +
    (liqBias > 0 ? 1 : 0) * 0.15 +
    (newsSentiment > 0 ? 1 : 0) * 0.15;

  // Determine side based on composite
  const side = composite >= 0.55 ? 'LONG' : composite <= 0.45 ? 'SHORT' : 'NEUTRAL';

  return {
    composite: Math.round(composite * 100) / 100,
    side,
    breakdown: {
      ema: emaScore,
      rsi: rsiScore,
      volume: volumeScore,
      liquidation: liqBias,
      news: newsSentiment
    }
  };
}
