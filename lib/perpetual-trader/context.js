import { supabase } from '../supabase.js';
import { fetchOHLCVWithFallback } from '../crawler-ohlcv.js';
import { getLatestRegime, checkStrategyRegime } from '../mock-trading/market-regime-filter.js';
import { checkTradingWindow } from '../mock-trading/trading-window-filter.js';
import { getDynamicThreshold } from '../mock-trading/dynamic-confidence.js';
import { isComboThrottled } from '../mock-trading/strategy-scorecard.js';

export async function buildPerpetualTradeContext(signal) {
  const symbol = signal.symbol;
  const timeframe = signal.timeframe || '15m';
  const [ohlcvResult, regimeSnapshot, fundingRow, oiRow] = await Promise.all([
    fetchOHLCVWithFallback(symbol, timeframe, 60).catch(() => ({ data: [] })),
    getLatestRegime(symbol, timeframe).catch(() => ({ regime: 'unknown', details: null })),
    supabase.from('market_data').select('funding_rate, volume_change_pct, news_sentiment_score').eq('symbol', symbol).order('timestamp', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('open_interest_snapshots').select('funding_rate').eq('symbol', symbol).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const ohlcv = (ohlcvResult?.data || []).map((candle) => ({
    timestamp: candle[0],
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5],
  }));
  const regime = regimeSnapshot?.regime || 'unknown';
  const marketRow = fundingRow?.data || {};
  const fundingRate = Number(marketRow.funding_rate ?? oiRow?.data?.funding_rate ?? signal.metadata?.funding_rate ?? 0);
  const newsSentimentScore = Number(marketRow.news_sentiment_score ?? signal.metadata?.news_sentiment_score ?? 0);
  const volumeChangePct = Number(marketRow.volume_change_pct ?? signal.metadata?.volume_change_pct ?? 0);
  const atr = computeAtr(ohlcv);
  const atrPct = ohlcv.length ? (atr / Number(ohlcv[ohlcv.length - 1].close || 1)) * 100 : 2;

  const regimeCheck = checkStrategyRegime(signal.strategy || 'default', regime);
  const throttle = await isComboThrottled(signal.strategy || 'unknown', symbol, timeframe, regime);
  const threshold = await getDynamicThreshold(signal.strategy || 'unknown', symbol, timeframe, regime, { atrPct });
  const window = await checkTradingWindow(symbol, {
    fundingRate,
    newsSentimentScore,
    volumeChangePct,
    liqRiskScore: signal.metadata?.liq_risk_score || 0,
    spreadBps: signal.metadata?.spread_bps || 0,
  }, signal);

  return {
    regime,
    regimeDetails: regimeSnapshot?.details || null,
    regimeCheck,
    throttle,
    threshold,
    window,
    fundingRate,
    atr,
    atrPct,
  };
}

function computeAtr(candles = [], period = 14) {
  if (candles.length < 2) return 0;
  const recent = candles.slice(-(period + 1));
  const ranges = [];
  for (let i = 1; i < recent.length; i++) {
    const high = Number(recent[i].high);
    const low = Number(recent[i].low);
    const prevClose = Number(recent[i - 1].close);
    ranges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}
