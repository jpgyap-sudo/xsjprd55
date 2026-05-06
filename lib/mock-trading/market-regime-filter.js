// ============================================================
// Market Regime Filter — ADX/ATR-Based Regime Detection
// Labels current market state and blocks unsuitable strategies.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

// ── Strategy-Regime Compatibility Matrix ────────────────────
// Each entry: { trending, ranging, high_volatility, news_risk }
// Values: 'yes' | 'no' | 'reduce' (reduce size)

const STRATEGY_REGIME_MAP = {
  'EMA_Cross':         { trending: 'yes', ranging: 'no', high_volatility: 'reduce', news_risk: 'no' },
  'RSI_Bounce':        { trending: 'reduce', ranging: 'yes', high_volatility: 'no', news_risk: 'no' },
  'Volume_Filter':     { trending: 'yes', ranging: 'no', high_volatility: 'yes', news_risk: 'reduce' },
  'EMA_Cross_Volume':  { trending: 'yes', ranging: 'no', high_volatility: 'yes', news_risk: 'reduce' },
  'RSI_Bounce_Volume': { trending: 'reduce', ranging: 'yes', high_volatility: 'reduce', news_risk: 'no' },
  'tv_ta_scan':        { trending: 'yes', ranging: 'yes', high_volatility: 'reduce', news_risk: 'no' },
  'default':           { trending: 'yes', ranging: 'yes', high_volatility: 'reduce', news_risk: 'no' },
};

const REGIME_LABELS = ['trending', 'ranging', 'high_volatility', 'news_risk'];

// ── Main: Detect Market Regime ──────────────────────────────

/**
 * Detect current market regime for a symbol.
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {object[]} ohlcv - Array of { open, high, low, close, volume } candles
 * @param {object} [context] - Optional { newsSentimentScore, fundingRate, liqRiskScore }
 * @returns {object} { regime: string, allowed: boolean, reason?: string, adjustment?: object, details: object }
 */
export async function detectMarketRegime(symbol, ohlcv, context = {}) {
  if (!ohlcv || ohlcv.length < 20) {
    return {
      regime: 'unknown',
      allowed: true,
      reason: 'Insufficient data for regime detection',
      adjustment: null,
      details: { adx: null, atrPct: null, volatilityLabel: null, newsRiskScore: 0 },
    };
  }

  // 1. Compute ADX (trend strength)
  const adx = computeADX(ohlcv);

  // 2. Compute ATR as % of price
  const atrPct = computeATRPct(ohlcv);

  // 3. Determine volatility label
  const volatilityLabel = getVolatilityLabel(atrPct);

  // 4. Check for news risk
  const newsRiskScore = context.newsSentimentScore
    ? Math.abs(context.newsSentimentScore)
    : 0;

  // 5. Classify regime
  let regime = classifyRegime(adx, atrPct, volatilityLabel, newsRiskScore);

  // 6. Save snapshot to DB
  await saveRegimeSnapshot(symbol, '15m', regime, adx, atrPct, volatilityLabel, newsRiskScore);

  return {
    regime,
    allowed: true, // Regime filter doesn't block by itself — it's used by the quality gate
    reason: null,
    adjustment: getRegimeAdjustment(regime),
    details: {
      adx: Math.round(adx * 10) / 10,
      atrPct: Math.round(atrPct * 100) / 100,
      volatilityLabel,
      newsRiskScore: Math.round(newsRiskScore * 100) / 100,
    },
  };
}

// ── Check Strategy Compatibility ────────────────────────────

/**
 * Check if a strategy is allowed in the current regime.
 * @param {string} strategy - Strategy name
 * @param {string} regime - Detected regime
 * @returns {object} { allowed: boolean, reason?: string, sizeAdjustment?: number }
 */
export function checkStrategyRegime(strategy, regime) {
  const mapping = STRATEGY_REGIME_MAP[strategy] || STRATEGY_REGIME_MAP['default'];
  const compatibility = mapping[regime];

  if (!compatibility) {
    return {
      allowed: true,
      reason: `Unknown regime "${regime}", allowing trade`,
      sizeAdjustment: 1.0,
    };
  }

  switch (compatibility) {
    case 'yes':
      return { allowed: true, reason: null, sizeAdjustment: 1.0 };
    case 'reduce':
      return {
        allowed: true,
        reason: `${strategy} is suboptimal in ${regime} regime — reducing position size by 50%`,
        sizeAdjustment: 0.5,
      };
    case 'no':
      return {
        allowed: false,
        reason: `${strategy} is not suitable for ${regime} regime`,
        sizeAdjustment: 0,
      };
    default:
      return { allowed: true, reason: null, sizeAdjustment: 1.0 };
  }
}

// ── ADX Computation ─────────────────────────────────────────

function computeADX(ohlcv, period = 14) {
  if (ohlcv.length < period + 1) return 0;

  const trValues = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < ohlcv.length; i++) {
    const high = ohlcv[i].high;
    const low = ohlcv[i].low;
    const prevClose = ohlcv[i - 1].close;
    const prevHigh = ohlcv[i - 1].high;
    const prevLow = ohlcv[i - 1].low;

    // True Range
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trValues.push(tr);

    // Directional Movement
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  // Smooth with Wilder's method
  const atr = wilderSmooth(trValues, period);
  const smoothedPlusDM = wilderSmooth(plusDM, period);
  const smoothedMinusDM = wilderSmooth(minusDM, period);

  // Directional Indicators
  const plusDI = atr > 0 ? (smoothedPlusDM / atr) * 100 : 0;
  const minusDI = atr > 0 ? (smoothedMinusDM / atr) * 100 : 0;

  // Directional Index
  const dx = (plusDI + minusDI) > 0
    ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100
    : 0;

  // ADX is smoothed DX
  // For simplicity, use last DX value (full smoothing would need another loop)
  return dx;
}

function wilderSmooth(values, period) {
  if (values.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < Math.min(period, values.length); i++) {
    sum += values[i];
  }

  let smoothed = sum / period;

  for (let i = period; i < values.length; i++) {
    smoothed = (smoothed * (period - 1) + values[i]) / period;
  }

  return smoothed;
}

// ── ATR as % of Price ───────────────────────────────────────

function computeATRPct(ohlcv, period = 14) {
  if (ohlcv.length < period + 1) return 0;

  const trValues = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const tr = Math.max(
      ohlcv[i].high - ohlcv[i].low,
      Math.abs(ohlcv[i].high - ohlcv[i - 1].close),
      Math.abs(ohlcv[i].low - ohlcv[i - 1].close)
    );
    trValues.push(tr);
  }

  const atr = wilderSmooth(trValues, period);
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  return currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
}

// ── Volatility Label ────────────────────────────────────────

function getVolatilityLabel(atrPct) {
  if (atrPct >= 3) return 'extreme';
  if (atrPct >= 1.5) return 'high';
  if (atrPct >= 0.8) return 'normal';
  return 'low';
}

// ── Regime Classification ───────────────────────────────────

function classifyRegime(adx, atrPct, volatilityLabel, newsRiskScore) {
  // News risk takes priority
  if (newsRiskScore > 0.8) {
    return 'news_risk';
  }

  // High volatility
  if (volatilityLabel === 'extreme' || (volatilityLabel === 'high' && atrPct > 2)) {
    return 'high_volatility';
  }

  // Trending (ADX > 25)
  if (adx > 25) {
    return 'trending';
  }

  // Ranging (ADX < 20)
  if (adx < 20) {
    return 'ranging';
  }

  // Borderline (ADX 20-25) — check volatility
  if (volatilityLabel === 'high') {
    return 'high_volatility';
  }

  return 'ranging'; // Default to ranging
}

// ── Regime Adjustment ───────────────────────────────────────

function getRegimeAdjustment(regime) {
  switch (regime) {
    case 'high_volatility':
      return {
        sizeMultiplier: 0.5,
        slMultiplier: 1.5, // Widen SL
        confidenceBonus: -0.03, // Raise threshold
      };
    case 'news_risk':
      return {
        sizeMultiplier: 0.3,
        slMultiplier: 2.0,
        confidenceBonus: -0.05,
      };
    case 'trending':
      return {
        sizeMultiplier: 1.0,
        slMultiplier: 1.0,
        confidenceBonus: 0.02, // Lower threshold slightly
      };
    case 'ranging':
      return {
        sizeMultiplier: 0.8,
        slMultiplier: 1.0,
        confidenceBonus: 0,
      };
    default:
      return {
        sizeMultiplier: 1.0,
        slMultiplier: 1.0,
        confidenceBonus: 0,
      };
  }
}

// ── Snapshot Persistence ────────────────────────────────────

async function saveRegimeSnapshot(symbol, timeframe, regime, adx, atrPct, volatilityLabel, newsRiskScore) {
  try {
    await supabase.from('market_regime_snapshots').insert({
      symbol,
      timeframe,
      regime,
      adx: Math.round(adx * 10) / 10,
      atr_pct: Math.round(atrPct * 100) / 100,
      volatility_label: volatilityLabel,
      news_risk_score: Math.round(newsRiskScore * 100) / 100,
    });
  } catch (err) {
    // Non-critical — don't throw
    console.error(`[RegimeFilter] Save snapshot error:`, err.message);
  }
}

// ── Get Latest Regime ───────────────────────────────────────

/**
 * Get the most recent regime snapshot for a symbol.
 */
export async function getLatestRegime(symbol, timeframe = '15m') {
  const { data, error } = await supabase
    .from('market_regime_snapshots')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { regime: 'unknown', details: null };
  }

  return {
    regime: data.regime,
    details: {
      adx: data.adx,
      atrPct: data.atr_pct,
      volatilityLabel: data.volatility_label,
      newsRiskScore: data.news_risk_score,
      snapshotAt: data.snapshot_at,
    },
  };
}
