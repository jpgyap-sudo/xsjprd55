// ============================================================
// Feature Mapper — xsjprd55
// Maps signal context / market data to ML feature dict
// ============================================================

export function mapSignalContextToMlFeatures(ctx = {}) {
  return {
    close: Number(ctx.close || ctx.price || 0),
    volume: Number(ctx.volume || 0),
    rsi: Number(ctx.rsi || 0),
    macd: Number(ctx.macd || 0),
    macd_signal: Number(ctx.macdSignal || ctx.macd_signal || 0),
    ema_fast: Number(ctx.emaFast || ctx.ema_fast || 0),
    ema_slow: Number(ctx.emaSlow || ctx.ema_slow || 0),
    atr: Number(ctx.atr || 0),
    funding_rate: Number(ctx.fundingRate || ctx.funding_rate || 0),
    open_interest_change: Number(ctx.openInterestChange || ctx.open_interest_change || 0),
    liquidation_long_usd: Number(ctx.liquidationLongUsd || ctx.liquidation_long_usd || 0),
    liquidation_short_usd: Number(ctx.liquidationShortUsd || ctx.liquidation_short_usd || 0),
    sentiment_score: Number(ctx.sentimentScore || ctx.sentiment_score || 0),
    social_volume: Number(ctx.socialVolume || ctx.social_volume || 0),
  };
}

export function mapOhlcvToMlFeatures(ohlcv) {
  const closes = ohlcv.map(c => c[4]);
  const volumes = ohlcv.map(c => c[5]);
  const latest = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];

  // Simple RSI approximation
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.filter(d => d > 0);
  const losses = changes.filter(d => d < 0).map(Math.abs);
  const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0.001;
  const rsi = 100 - (100 / (1 + avgGain / avgLoss));

  // Simple MACD approximation
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12[ema12.length - 1] - ema26[ema26.length - 1];
  const signalLine = ema(ema12.map((v, i) => v - ema26[i]).filter(v => !isNaN(v)), 9);
  const macdSignal = signalLine[signalLine.length - 1] || 0;

  // ATR
  const trs = ohlcv.slice(1).map((c, i) => {
    const [, h, l] = c;
    const cPrev = ohlcv[i][4];
    return Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev));
  });
  const atr = trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;

  return {
    close: latest[4],
    volume: latest[5],
    rsi: Number(rsi.toFixed(2)),
    macd: Number(macd.toFixed(4)),
    macd_signal: Number(macdSignal.toFixed(4)),
    ema_fast: Number(ema12[ema12.length - 1].toFixed(2)),
    ema_slow: Number(ema26[ema26.length - 1].toFixed(2)),
    atr: Number(atr.toFixed(2)),
    funding_rate: 0,
    open_interest_change: 0,
    liquidation_long_usd: 0,
    liquidation_short_usd: 0,
    sentiment_score: 0,
    social_volume: volumes[volumes.length - 1],
  };
}

function ema(data, period) {
  const k = 2 / (period + 1);
  let e = data[0];
  const out = [e];
  for (let i = 1; i < data.length; i++) {
    e = data[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}
