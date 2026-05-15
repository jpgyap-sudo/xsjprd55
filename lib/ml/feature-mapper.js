// ============================================================
// Feature Mapper — xsjprd55
// Maps signal context / market data to ML feature dict
// ============================================================

import { ema, rsi, atr, last } from '../indicators.js';

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

  // RSI via shared indicator
  const rsiValues = rsi(closes, 14);
  const rsiVal = last(rsiValues, 50);

  // EMA via shared indicator
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = last(ema12, 0) - last(ema26, 0);
  const macdSignalLine = ema(ema12.map((v, i) => v - ema26[i]).filter(v => v !== null && !isNaN(v)), 9);
  const macdSignal = last(macdSignalLine, 0);

  // ATR via shared indicator
  const atrValues = atr(ohlcv, 14);
  const atrVal = last(atrValues, 0);

  return {
    close: latest[4],
    volume: latest[5],
    rsi: Number(rsiVal.toFixed(2)),
    macd: Number(macd.toFixed(4)),
    macd_signal: Number(macdSignal.toFixed(4)),
    ema_fast: Number(last(ema12, 0).toFixed(2)),
    ema_slow: Number(last(ema26, 0).toFixed(2)),
    atr: Number(atrVal.toFixed(2)),
    funding_rate: 0,
    open_interest_change: 0,
    liquidation_long_usd: 0,
    liquidation_short_usd: 0,
    sentiment_score: 0,
    social_volume: volumes[volumes.length - 1],
  };
}
