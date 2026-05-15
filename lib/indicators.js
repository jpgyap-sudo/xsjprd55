// ============================================================
// Shared Technical Indicators — xsjprd55
// Single source of truth for RSI, EMA, ATR, and other
// technical indicators used across the project.
// ============================================================

/**
 * Compute Exponential Moving Average.
 * @param {number[]} data - Array of values (e.g. closing prices)
 * @param {number} period - EMA period (default 14)
 * @returns {number[]} EMA values aligned with input (first period-1 entries are null)
 */
export function ema(data, period = 14) {
  if (!data || data.length < period) return data.map(() => null);
  const k = 2 / (period + 1);
  const result = [];
  // SMA seed
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result.push(sum / period);
  // EMA
  for (let i = period; i < data.length; i++) {
    result.push((data[i] - result[result.length - 1]) * k + result[result.length - 1]);
  }
  // Pad front with nulls to match input length
  const padded = new Array(period - 1).fill(null);
  return [...padded, ...result];
}

/**
 * Compute Relative Strength Index.
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - RSI period (default 14)
 * @returns {number[]} RSI values (0-100), first `period` entries are null
 */
export function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) {
    return closes ? closes.map(() => null) : [];
  }
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const results = [];
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    results.push(100 - 100 / (1 + rs));
  }
  const padded = new Array(period).fill(null);
  return [...padded, ...results];
}

/**
 * Compute Average True Range.
 * Accepts both object-format candles ({ high, low, close }) and
 * array-format candles ([open, high, low, close, volume]).
 * @param {Array} ohlcv - OHLCV candles (object or array format)
 * @param {number} period - ATR period (default 14)
 * @returns {number[]} ATR values, first `period` entries are null
 */
export function atr(ohlcv, period = 14) {
  if (!ohlcv || ohlcv.length < period + 1) {
    return ohlcv ? ohlcv.map(() => null) : [];
  }
  const trs = [];
  for (let i = 0; i < ohlcv.length; i++) {
    const c = ohlcv[i];
    const high = Array.isArray(c) ? c[2] : c.high;
    const low = Array.isArray(c) ? c[3] : c.low;
    const prevClose = i === 0
      ? (Array.isArray(c) ? c[4] : c.close)
      : (Array.isArray(ohlcv[i - 1]) ? ohlcv[i - 1][4] : ohlcv[i - 1].close);
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }
  // First ATR is SMA of TRs
  const atrs = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  atrs.push(sum / period);
  for (let i = period; i < trs.length; i++) {
    atrs.push((atrs[atrs.length - 1] * (period - 1) + trs[i]) / period);
  }
  const padded = new Array(period - 1).fill(null);
  return [...padded, ...atrs];
}

/**
 * Get the last (most recent) non-null value from an array.
 * Useful for extracting the final RSI/EMA/ATR value from indicator arrays.
 * @param {Array} arr - Array possibly containing nulls
 * @param {number} fallback - Fallback value if all null
 * @returns {number}
 */
export function last(arr, fallback = 0) {
  if (!arr || arr.length === 0) return fallback;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return arr[i];
  }
  return fallback;
}
