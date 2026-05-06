// ============================================================
// Dynamic Confidence Thresholds — Adaptive Threshold Management
// Adjusts minimum confidence based on recent performance,
// liquidity, and market volatility.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const BASE_THRESHOLD = parseFloat(process.env.DYNAMIC_CONFIDENCE_BASE) || 0.65;
const MIN_THRESHOLD = parseFloat(process.env.DYNAMIC_CONFIDENCE_MIN) || 0.60;
const MAX_THRESHOLD = parseFloat(process.env.DYNAMIC_CONFIDENCE_MAX) || 0.85;
const LOW_LIQUIDITY_PENALTY = parseFloat(process.env.DYNAMIC_CONFIDENCE_LIQUIDITY_PENALTY) || 0.05;
const HIGH_VOL_PENALTY = parseFloat(process.env.DYNAMIC_CONFIDENCE_VOL_PENALTY) || 0.03;

// In-memory cache to reduce DB reads
const thresholdCache = new Map();
const CACHE_TTL_MS = 60000; // 1 minute

// ── Main: Get Effective Threshold ───────────────────────────

/**
 * Get the effective confidence threshold for a (strategy, symbol, timeframe) combo.
 * Combines base threshold + scorecard dynamic adjustment + market conditions.
 * @param {string} strategy - Strategy name
 * @param {string} symbol - Trading pair
 * @param {string} timeframe - Timeframe
 * @param {string} [marketRegime] - Current market regime
 * @param {object} [context] - Optional { volumeRank, atrPct }
 * @returns {object} { threshold: number, reason: string }
 */
export async function getDynamicThreshold(strategy, symbol, timeframe, marketRegime, context = {}) {
  const cacheKey = `${strategy}|${symbol}|${timeframe}|${marketRegime || 'any'}`;

  // Check cache
  const cached = thresholdCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return { threshold: cached.threshold, reason: cached.reason };
  }

  let threshold = BASE_THRESHOLD;
  const adjustments = [];

  // ── 1. Scorecard-Based Adjustment ───────────────────────
  try {
    const { data: scorecard } = await supabase
      .from('strategy_scorecard')
      .select('dynamic_threshold, consecutive_losses, consecutive_wins, total_trades')
      .eq('strategy_name', strategy)
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .maybeSingle();

    if (scorecard) {
      // Use stored dynamic threshold if available
      if (scorecard.dynamic_threshold) {
        threshold = parseFloat(scorecard.dynamic_threshold);
        adjustments.push(`scorecard: ${(threshold * 100).toFixed(0)}%`);
      }

      // Additional adjustment for consecutive losses beyond what scorecard tracks
      if (scorecard.consecutive_losses >= 5) {
        threshold += 0.05;
        adjustments.push(`+5% (${scorecard.consecutive_losses} consecutive losses)`);
      }
      if (scorecard.consecutive_losses >= 8) {
        threshold += 0.05;
        adjustments.push(`+5% (deep loss streak)`);
      }

      // If very few trades, be more permissive (learning phase)
      if (scorecard.total_trades < 5) {
        threshold = Math.min(threshold, 0.60);
        adjustments.push(`learning phase (${scorecard.total_trades} trades)`);
      }
    }
  } catch (err) {
    console.error(`[DynamicConf] Scorecard fetch error:`, err.message);
  }

  // ── 2. Market Regime Adjustment ─────────────────────────
  if (marketRegime) {
    switch (marketRegime) {
      case 'high_volatility':
        threshold += HIGH_VOL_PENALTY;
        adjustments.push(`+${(HIGH_VOL_PENALTY * 100).toFixed(0)}% (high volatility)`);
        break;
      case 'news_risk':
        threshold += HIGH_VOL_PENALTY + 0.02;
        adjustments.push(`+${((HIGH_VOL_PENALTY + 0.02) * 100).toFixed(0)}% (news risk)`);
        break;
      case 'trending':
        threshold -= 0.02; // Slightly easier in trends
        adjustments.push(`-2% (trending)`);
        break;
    }
  }

  // ── 3. Volatility Adjustment ────────────────────────────
  if (context.atrPct) {
    if (context.atrPct > 3) {
      threshold += 0.05;
      adjustments.push(`+5% (ATR ${context.atrPct.toFixed(1)}%)`);
    } else if (context.atrPct > 2) {
      threshold += 0.03;
      adjustments.push(`+3% (ATR ${context.atrPct.toFixed(1)}%)`);
    }
  }

  // ── 4. Liquidity Adjustment ─────────────────────────────
  if (context.volumeRank !== undefined) {
    // volumeRank: 0 = lowest liquidity, 1 = highest
    if (context.volumeRank < 0.2) {
      threshold += LOW_LIQUIDITY_PENALTY;
      adjustments.push(`+${(LOW_LIQUIDITY_PENALTY * 100).toFixed(0)}% (low liquidity)`);
    }
  }

  // ── Clamp ───────────────────────────────────────────────
  const originalThreshold = threshold;
  threshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, threshold));

  if (threshold !== originalThreshold) {
    adjustments.push(`clamped to [${(MIN_THRESHOLD * 100).toFixed(0)}%-${(MAX_THRESHOLD * 100).toFixed(0)}%]`);
  }

  const result = {
    threshold: Math.round(threshold * 100) / 100,
    reason: adjustments.length > 0 ? adjustments.join('; ') : 'base threshold',
  };

  // Update cache
  thresholdCache.set(cacheKey, {
    threshold: result.threshold,
    reason: result.reason,
    timestamp: Date.now(),
  });

  return result;
}

// ── Manual Threshold Override ───────────────────────────────

/**
 * Manually set the dynamic threshold for a combo.
 */
export async function setDynamicThreshold(strategy, symbol, timeframe, threshold) {
  const clamped = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, threshold));

  const { error } = await supabase
    .from('strategy_scorecard')
    .update({
      dynamic_threshold: Math.round(clamped * 100) / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('strategy_name', strategy)
    .eq('symbol', symbol)
    .eq('timeframe', timeframe);

  if (error) {
    console.error(`[DynamicConf] Set threshold error:`, error);
    return false;
  }

  // Clear cache for this key
  const cacheKey = `${strategy}|${symbol}|${timeframe}|any`;
  thresholdCache.delete(cacheKey);

  return true;
}

// ── Clear Cache ─────────────────────────────────────────────

export function clearThresholdCache() {
  thresholdCache.clear();
}
