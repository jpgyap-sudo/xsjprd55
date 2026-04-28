// ============================================================
// TradingView Technical Analysis Scraper
// Uses tradingview-ta (unofficial) to fetch indicator summaries
// for any symbol without requiring login credentials.
// Feeds research agent with BUY/SELL/NEUTRAL consensus + oscillator data.
// ============================================================

import { logger } from './logger.js';

const TV_API_URL = 'https://scanner.tradingview.com/crypto/scan';

/**
 * Map our symbol format to TradingView's format.
 * e.g. "BTC/USDT" -> "BINANCE:BTCUSDT"
 */
export function toTvSymbol(symbol, exchange = 'BINANCE') {
  const clean = symbol.replace('/', '').replace('-', '');
  return `${exchange}:${clean}`;
}

/**
 * Fetch TradingView technical analysis summary for a symbol.
 * @param {string} symbol - e.g. "BTCUSDT"
 * @param {string} exchange - default "BINANCE"
 * @param {string} interval - "1m","5m","15m","1h","4h","1D","1W"
 * @returns {Promise<Object|null>}
 */
export async function fetchTvAnalysis(symbol, exchange = 'BINANCE', interval = '15m') {
  const tvSymbol = toTvSymbol(symbol, exchange);
  const payload = {
    symbols: { tickers: [tvSymbol], query: { types: [] } },
    columns: [
      'Recommend.Other',
      'Recommend.All',
      'Recommend.MA',
      'RSI',
      'RSI[1]',
      'Stoch.K',
      'Stoch.D',
      'Stoch.K[1]',
      'Stoch.D[1]',
      'CCI20',
      'CCI20[1]',
      'ADX',
      'ADX+DI',
      'ADX-DI',
      'ADX+DI[1]',
      'ADX-DI[1]',
      'AO',
      'AO[1]',
      'Mom',
      'Mom[1]',
      'MACD.macd',
      'MACD.signal',
      'Rec.BBPower',
      'Rec.UO',
      'EMA10',
      'close',
      'SMA10',
      'EMA20',
      'SMA20',
      'EMA30',
      'SMA30',
      'EMA50',
      'SMA50',
      'EMA100',
      'SMA100',
      'EMA200',
      'SMA200',
      'Rec.Ichimoku',
      'Rec.VWMA',
      'Rec.HullMA9',
    ],
  };

  try {
    const res = await fetch(TV_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn(`[TV-TA] HTTP ${res.status} for ${tvSymbol}`);
      return null;
    }
    const data = await res.json();
    if (!data.data || !data.data[0]) return null;

    const d = data.data[0].d;
    const fields = payload.columns;
    const result = {};
    fields.forEach((f, i) => {
      result[f] = d[i];
    });

    // Extract recommendation text
    const recMap = { '-1': 'SELL', '0': 'NEUTRAL', '1': 'BUY' };
    const summary = {
      symbol,
      exchange,
      interval,
      overall: recMap[String(result['Recommend.All'])] || 'NEUTRAL',
      oscillator: recMap[String(result['Recommend.Other'])] || 'NEUTRAL',
      movingAverage: recMap[String(result['Recommend.MA'])] || 'NEUTRAL',
      rsi: result['RSI'],
      rsiPrev: result['RSI[1]'],
      macd: result['MACD.macd'],
      macdSignal: result['MACD.signal'],
      stochK: result['Stoch.K'],
      stochD: result['Stoch.D'],
      adx: result['ADX'],
      adxPlus: result['ADX+DI'],
      adxMinus: result['ADX-DI'],
      ema10: result['EMA10'],
      ema20: result['EMA20'],
      ema50: result['EMA50'],
      ema200: result['EMA200'],
      close: result['close'],
      fetchedAt: new Date().toISOString(),
    };

    logger.info(`[TV-TA] ${tvSymbol} ${interval} -> ${summary.overall} (RSI:${summary.rsi?.toFixed(1)})`);
    return summary;
  } catch (err) {
    logger.warn(`[TV-TA] Error for ${tvSymbol}: ${err.message}`);
    return null;
  }
}

/**
 * Batch-fetch TV analysis for multiple symbols.
 * @param {string[]} symbols
 * @param {string} interval
 * @returns {Promise<Object[]>}
 */
export async function fetchTvAnalysisBatch(symbols, interval = '15m') {
  const results = [];
  for (const sym of symbols) {
    const r = await fetchTvAnalysis(sym, 'BINANCE', interval);
    if (r) results.push(r);
    // Small delay to avoid rate limits
    await new Promise((res) => setTimeout(res, 350));
  }
  return results;
}

/**
 * Convert TV analysis into a research-item for the research agent.
 * @param {Object} analysis
 * @returns {Object} research item
 */
export function tvAnalysisToResearchItem(analysis) {
  const { symbol, interval, overall, oscillator, movingAverage, rsi, macd, adx, close } = analysis;
  const hints = [];
  if (overall === 'BUY') hints.push('bullish');
  if (overall === 'SELL') hints.push('bearish');
  if (rsi < 30) hints.push('oversold');
  if (rsi > 70) hints.push('overbought');
  if (macd > 0) hints.push('macd bullish');
  if (macd < 0) hints.push('macd bearish');
  if (adx > 25) hints.push('strong trend');

  const content = `TradingView Technical Analysis for ${symbol} (${interval}): ` +
    `Overall=${overall}, Oscillator=${oscillator}, MA=${movingAverage}. ` +
    `RSI=${rsi?.toFixed(1)}, MACD=${macd?.toFixed(4)}, ADX=${adx?.toFixed(1)}, Close=${close}. ` +
    `Indicators suggest ${overall.toLowerCase()} bias.`;

  return {
    sourceName: `tradingview_ta_${interval}`,
    sourceUrl: `https://www.tradingview.com/symbols/${symbol}/`,
    content,
    metadata: { symbol, interval, overall, rsi, macd, adx, close, hints },
  };
}
