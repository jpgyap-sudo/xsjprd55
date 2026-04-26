// ============================================================
// Signal Engine — Technical Strategies for xsjprd55
// EMA Cross, RSI Bounce, Volume Filter
// All parameters read from environment with sensible defaults.
// ============================================================

import { v4 as uuidv4 } from 'uuid';

// ── Environment-configurable parameters ─────────────────────
const EMA_SHORT = Number(process.env.EMA_SHORT_PERIOD || 9);
const EMA_LONG  = Number(process.env.EMA_LONG_PERIOD || 21);
const RSI_PERIOD = Number(process.env.RSI_PERIOD || 14);
const RSI_OVERBOUGHT = Number(process.env.RSI_OVERBOUGHT || 70);
const RSI_OVERSOLD   = Number(process.env.RSI_OVERSOLD || 30);
const CONFIDENCE_THRESHOLD = Number(process.env.SIGNAL_CONFIDENCE_THRESHOLD || 0.65);

// ── Helpers ─────────────────────────────────────────────────
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

function rsi(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rsis = [];
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - (100 / (1 + rs)));
  }
  return rsis;
}

function atr(ohlcv, period = 14) {
  const trs = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const [, h, l, cPrev] = [ohlcv[i][2], ohlcv[i][3], ohlcv[i-1][4]];
    const tr = Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev));
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

// ── Signal builder ──────────────────────────────────────────
export function buildSignal(opts) {
  const now = new Date().toISOString();
  const ttlMinutes = opts.ttl_minutes || 60;
  return {
    id: opts.id || uuidv4(),
    symbol: opts.symbol,
    side: opts.side,
    entry_price: opts.entry_price ?? opts.price ?? null,
    stop_loss: opts.stop_loss ?? null,
    take_profit: Array.isArray(opts.take_profit) ? opts.take_profit : (opts.take_profit ? [opts.take_profit] : []),
    confidence: opts.confidence ?? 0.5,
    strategy: opts.strategy || 'Unknown',
    timeframe: opts.timeframe || '1h',
    generated_at: opts.generated_at || now,
    valid_until: opts.valid_until || new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    source: opts.source || 'unknown',
    mode: opts.mode || process.env.TRADING_MODE || 'paper',
    status: 'active',
    metadata: opts.metadata || {}
  };
}

// ── Strategy: EMA Cross ─────────────────────────────────────
export function strategy_EMACross(pair, tf, ohlcv) {
  const closes = ohlcv.map(c => c[4]);
  if (closes.length < EMA_LONG + 5) return null;

  const emaShort = ema(closes, EMA_SHORT);
  const emaLong  = ema(closes, EMA_LONG);
  const prevS = emaShort[emaShort.length - 2];
  const prevL = emaLong[emaLong.length - 2];
  const currS = emaShort[emaShort.length - 1];
  const currL = emaLong[emaLong.length - 1];

  let side = null;
  if (prevS <= prevL && currS > currL) side = 'LONG';
  if (prevS >= prevL && currS < currL) side = 'SHORT';
  if (!side) return null;

  const close = closes[closes.length - 1];
  const atrVal = atr(ohlcv, 14) || (Math.max(...closes.slice(-14)) - Math.min(...closes.slice(-14)));
  const sl = side === 'LONG' ? close - atrVal * 0.8 : close + atrVal * 0.8;
  const tp1 = side === 'LONG' ? close + atrVal * 1.2 : close - atrVal * 1.2;
  const tp2 = side === 'LONG' ? close + atrVal * 2.0 : close - atrVal * 2.0;

  return buildSignal({
    symbol: pair.replace('/', ''),
    side,
    entry_price: parseFloat(close.toFixed(4)),
    stop_loss: parseFloat(sl.toFixed(4)),
    take_profit: [parseFloat(tp1.toFixed(4)), parseFloat(tp2.toFixed(4))],
    confidence: 0.72,
    strategy: 'EMA_Cross',
    timeframe: tf,
    source: 'binance_futures',
    ttl_minutes: tf === '15m' ? 60 : tf === '1h' ? 240 : 960
  });
}

// ── Strategy: RSI Bounce ────────────────────────────────────
export function strategy_RSIBounce(pair, tf, ohlcv) {
  const closes = ohlcv.map(c => c[4]);
  if (closes.length < RSI_PERIOD + 5) return null;

  const rsis = rsi(closes, RSI_PERIOD);
  if (rsis.length < 2) return null;
  const prev = rsis[rsis.length - 2];
  const curr = rsis[rsis.length - 1];

  let side = null;
  if (prev < RSI_OVERSOLD && curr > RSI_OVERSOLD) side = 'LONG';
  if (prev > RSI_OVERBOUGHT && curr < RSI_OVERBOUGHT) side = 'SHORT';
  if (!side) return null;

  const close = closes[closes.length - 1];
  const atrVal = atr(ohlcv, 14) || (Math.max(...closes.slice(-14)) - Math.min(...closes.slice(-14)));
  const sl = side === 'LONG' ? close - atrVal : close + atrVal;
  const tp = side === 'LONG' ? close + atrVal * 1.5 : close - atrVal * 1.5;

  return buildSignal({
    symbol: pair.replace('/', ''),
    side,
    entry_price: parseFloat(close.toFixed(4)),
    stop_loss: parseFloat(sl.toFixed(4)),
    take_profit: [parseFloat(tp.toFixed(4))],
    confidence: 0.65,
    strategy: 'RSI_Bounce',
    timeframe: tf,
    source: 'binance_futures',
    ttl_minutes: tf === '15m' ? 60 : tf === '1h' ? 240 : 960
  });
}

// ── Strategy: Volume Filter (confirms EMA/RSI with volume spike) ─
export function strategy_VolumeFilter(pair, tf, ohlcv) {
  if (ohlcv.length < 21) return null;
  const volumes = ohlcv.map(c => c[5]);
  const avgVol = volumes.slice(-20, -1).reduce((a, b) => a + b, 0) / 20;
  const lastVol = volumes[volumes.length - 1];
  if (lastVol < avgVol * 1.5) return null; // no volume spike

  // Delegate to EMA Cross if volume confirms
  const emaSignal = strategy_EMACross(pair, tf, ohlcv);
  if (emaSignal) {
    emaSignal.strategy = 'EMA_Cross_Volume';
    emaSignal.confidence = Math.min(0.90, emaSignal.confidence + 0.10);
    return emaSignal;
  }

  const rsiSignal = strategy_RSIBounce(pair, tf, ohlcv);
  if (rsiSignal) {
    rsiSignal.strategy = 'RSI_Bounce_Volume';
    rsiSignal.confidence = Math.min(0.85, rsiSignal.confidence + 0.10);
    return rsiSignal;
  }

  return null;
}

// ── Run all strategies ──────────────────────────────────────
export function runAllStrategies(pair, tf, ohlcv) {
  const results = [];
  const strategies = [strategy_EMACross, strategy_RSIBounce, strategy_VolumeFilter];
  for (const strat of strategies) {
    const sig = strat(pair, tf, ohlcv);
    if (sig && sig.confidence >= CONFIDENCE_THRESHOLD) {
      results.push(sig);
    }
  }
  // De-duplicate: if VolumeFilter already emitted, skip the base strategy duplicate
  const seen = new Set();
  const deduped = [];
  for (const s of results) {
    const key = `${s.symbol}-${s.side}-${s.strategy}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }
  return deduped;
}
