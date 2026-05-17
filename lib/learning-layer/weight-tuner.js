// ============================================================
// Adaptive Weight Tuner — Dynamically adjusts strategy weights
// based on detected market regime and discovered patterns.
//
// Like SuperRoo's neural weight adjustment but for trading
// strategies — boosts strategies that match current regime,
// reduces those that don't.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

/**
 * Get the regime-to-strategy affinity map.
 * Higher = more suitable for that regime.
 */
function getRegimeAffinity() {
  return {
    trending: {
      trend_following: 1.0,
      momentum: 0.9,
      breakout: 0.8,
      ema_cross: 0.85,
      macd: 0.75,
      mean_reversion: 0.2,
      scalping: 0.3,
      grid: 0.1,
    },
    choppy: {
      mean_reversion: 0.8,
      scalping: 0.7,
      grid: 0.6,
      trend_following: 0.1,
      momentum: 0.15,
      breakout: 0.2,
      ema_cross: 0.25,
      macd: 0.3,
    },
    ranging: {
      mean_reversion: 0.9,
      grid: 0.8,
      scalping: 0.7,
      rsi_reversal: 0.85,
      support_resistance: 0.8,
      trend_following: 0.3,
      momentum: 0.25,
      breakout: 0.35,
    },
    quiet: {
      scalping: 0.8,
      grid: 0.7,
      mean_reversion: 0.5,
      breakout: 0.4,
      trend_following: 0.2,
      momentum: 0.15,
    },
    mixed: {
      trend_following: 0.5,
      mean_reversion: 0.5,
      scalping: 0.5,
      breakout: 0.5,
      momentum: 0.5,
      grid: 0.5,
    },
    unknown: {
      trend_following: 0.5,
      mean_reversion: 0.5,
      scalping: 0.5,
      breakout: 0.5,
      momentum: 0.5,
      grid: 0.5,
    },
  };
}

/**
 * Normalize a strategy name to a known key.
 */
function normalizeStrategy(name) {
  if (!name) return 'unknown';
  const n = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const known = [
    'trend_following', 'momentum', 'breakout', 'ema_cross', 'macd',
    'mean_reversion', 'scalping', 'grid', 'rsi_reversal',
    'support_resistance', 'brain_central',
  ];
  for (const k of known) {
    if (n.includes(k)) return k;
  }
  return 'unknown';
}

/**
 * Tune adaptive weights for all strategies based on current regime.
 * @param {Object|null} regime - Current market regime from detectMarketRegime()
 * @returns {Promise<number>} Number of weights updated
 */
export async function tuneAdaptiveWeights(regime) {
  if (!regime?.regime) {
    logger.info('[weight-tuner] No regime data, skipping');
    return 0;
  }

  const affinity = getRegimeAffinity();
  const regimeMap = affinity[regime.regime] || affinity.unknown;

  // Fetch existing strategy weights from brain
  const { data: existingWeights, error } = await supabase
    .from('brain_strategy_weights')
    .select('*');

  if (error) {
    logger.error('[weight-tuner] Fetch error:', error.message);
    return 0;
  }

  let updated = 0;

  for (const ew of existingWeights || []) {
    const strategyKey = normalizeStrategy(ew.strategy);
    const baseWeight = regimeMap[strategyKey] ?? 0.5;

    // Blend: 70% regime-based, 30% historical performance
    const historicalWeight = Number(ew.weight || 0.5);
    const newWeight = baseWeight * 0.7 + historicalWeight * 0.3;

    // Clamp to [0.05, 0.95]
    const clampedWeight = Math.max(0.05, Math.min(0.95, newWeight));

    const { error: updateErr } = await supabase
      .from('brain_strategy_weights')
      .update({
        weight: Number(clampedWeight.toFixed(4)),
        updated_at: new Date().toISOString(),
        metadata: {
          ...(ew.metadata || {}),
          last_regime: regime.regime,
          regime_affinity: baseWeight,
          blend_ratio: { regime: 0.7, historical: 0.3 },
        },
      })
      .eq('id', ew.id);

    if (!updateErr) updated++;
  }

  // Also create weights for strategies that don't exist yet
  for (const [strategyKey, affinityWeight] of Object.entries(regimeMap)) {
    const exists = (existingWeights || []).some(
      (ew) => normalizeStrategy(ew.strategy) === strategyKey
    );
    if (!exists) {
      const { error: insertErr } = await supabase
        .from('brain_strategy_weights')
        .insert({
          strategy: strategyKey,
          symbol: 'ALL',
          timeframe: 'ALL',
          weight: Number(affinityWeight.toFixed(4)),
          metadata: {
            created_by: 'tll_weight_tuner',
            regime: regime.regime,
            regime_affinity: affinityWeight,
          },
        });

      if (!insertErr) updated++;
    }
  }

  logger.info(`[weight-tuner] Updated ${updated} weights for regime=${regime.regime}`);
  return updated;
}
