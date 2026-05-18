// ============================================================
// Adaptive Weight Tuner — Dynamically adjusts strategy weights
// based on detected market regime, discovered patterns, and
// risk-adjusted performance metrics.
//
// Like SuperRoo's neural weight adjustment but for trading
// strategies — boosts strategies that match current regime,
// reduces those that don't.
//
// Risk-Adjusted Scoring (#7):
//   - Sharpe Ratio: (avg_return - risk_free) / std_dev_return
//   - Sortino Ratio: (avg_return - risk_free) / downside_deviation
//   - Max Drawdown: largest peak-to-trough decline
//   - Calmar Ratio: avg_return / max_drawdown
//   - Win Rate Consistency: std_dev of win_rate across timeframes
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

// ── Risk-Adjusted Scoring Functions (#7) ────────────────────

/**
 * Calculate Sharpe Ratio from a series of PnL values.
 * Sharpe = (mean_return - risk_free_rate) / std_dev_return
 * @param {number[]} returns - Array of PnL values
 * @param {number} riskFreeRate - Annual risk-free rate (default 0.02 = 2%)
 * @returns {number} Sharpe ratio (annualized)
 */
function calcSharpeRatio(returns, riskFreeRate = 0.02) {
  if (!returns?.length || returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  // Annualize: multiply by sqrt(periods_per_year)
  // Assuming daily returns: sqrt(365)
  const annualizedMean = mean * 365;
  const annualizedStd = stdDev * Math.sqrt(365);
  return (annualizedMean - riskFreeRate) / annualizedStd;
}

/**
 * Calculate Sortino Ratio — like Sharpe but only penalizes downside.
 * Sortino = (mean_return - risk_free_rate) / downside_deviation
 * @param {number[]} returns - Array of PnL values
 * @param {number} riskFreeRate - Annual risk-free rate (default 0.02)
 * @returns {number} Sortino ratio (annualized)
 */
function calcSortinoRatio(returns, riskFreeRate = 0.02) {
  if (!returns?.length || returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downsideReturns = returns.filter(r => r < 0);
  if (!downsideReturns.length) return 10; // No downside = excellent
  const downsideVariance = downsideReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / downsideReturns.length;
  const downsideDev = Math.sqrt(downsideVariance);
  if (downsideDev === 0) return 0;
  const annualizedMean = mean * 365;
  const annualizedDownside = downsideDev * Math.sqrt(365);
  return (annualizedMean - riskFreeRate) / annualizedDownside;
}

/**
 * Calculate maximum drawdown from a series of cumulative PnL values.
 * @param {number[]} cumulativePnl - Array of cumulative PnL values
 * @returns {number} Max drawdown as a positive percentage (e.g., 0.15 = 15% drawdown)
 */
function calcMaxDrawdown(cumulativePnl) {
  if (!cumulativePnl?.length) return 0;
  let peak = cumulativePnl[0];
  let maxDD = 0;
  for (const val of cumulativePnl) {
    if (val > peak) peak = val;
    const dd = peak > 0 ? (peak - val) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Calculate Calmar Ratio = annualized_return / max_drawdown
 * @param {number[]} returns - Array of PnL values
 * @param {number} maxDD - Pre-calculated max drawdown (optional)
 * @returns {number} Calmar ratio
 */
function calcCalmarRatio(returns, maxDD) {
  if (!returns?.length) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const annualizedReturn = mean * 365;
  const drawdown = maxDD ?? calcMaxDrawdown(returns.reduce((acc, r) => [...acc, (acc.at(-1) || 0) + r], []));
  if (drawdown === 0) return annualizedReturn > 0 ? 10 : -10;
  return annualizedReturn / drawdown;
}

/**
 * Calculate Win Rate Consistency — std dev of win rates across time windows.
 * Lower = more consistent.
 * @param {Object[]} signals - Array of signal objects with resolved_outcome
 * @returns {number} Consistency score (0-1, higher = more consistent)
 */
function calcWinRateConsistency(signals) {
  if (!signals?.length || signals.length < 10) return 0.5;
  // Split into 5 equal windows
  const windowSize = Math.floor(signals.length / 5);
  const winRates = [];
  for (let i = 0; i < 5; i++) {
    const slice = signals.slice(i * windowSize, (i + 1) * windowSize);
    const wins = slice.filter(s => s.resolved_outcome === 'win').length;
    winRates.push(wins / slice.length);
  }
  const mean = winRates.reduce((a, b) => a + b, 0) / winRates.length;
  const variance = winRates.reduce((sum, wr) => sum + (wr - mean) ** 2, 0) / winRates.length;
  const stdDev = Math.sqrt(variance);
  // Convert to 0-1 score: lower stdDev = higher consistency
  return Math.max(0, Math.min(1, 1 - stdDev * 2));
}

/**
 * Fetch risk-adjusted metrics for a specific strategy from brain_signal_memory.
 * @param {string} strategy - Strategy name
 * @returns {Promise<Object>} Risk-adjusted metrics
 */
async function getRiskAdjustedMetrics(strategy) {
  try {
    const { data: signals, error } = await supabase
      .from('brain_signal_memory')
      .select('resolved_outcome, resolved_pnl, resolved_at')
      .eq('strategy', strategy)
      .not('resolved_outcome', 'is', null)
      .order('resolved_at', { ascending: true })
      .limit(500);

    if (error || !signals?.length) {
      return { sharpe: 0, sortino: 0, maxDrawdown: 0, calmar: 0, consistency: 0.5 };
    }

    const pnls = signals.map(s => parseFloat(s.resolved_pnl) || 0);
    const cumulativePnl = pnls.reduce((acc, p) => [...acc, (acc.at(-1) || 0) + p], []);

    const sharpe = calcSharpeRatio(pnls);
    const sortino = calcSortinoRatio(pnls);
    const maxDD = calcMaxDrawdown(cumulativePnl);
    const calmar = calcCalmarRatio(pnls, maxDD);
    const consistency = calcWinRateConsistency(signals);

    return { sharpe, sortino, maxDrawdown: maxDD, calmar, consistency };
  } catch (e) {
    logger.error(`[weight-tuner] getRiskAdjustedMetrics error for ${strategy}:`, e.message);
    return { sharpe: 0, sortino: 0, maxDrawdown: 0, calmar: 0, consistency: 0.5 };
  }
}

/**
 * Calculate a composite risk-adjusted score from individual metrics.
 * Score = 0.3*sharpe_norm + 0.2*sortino_norm + 0.2*calmar_norm + 0.15*(1-maxDD) + 0.15*consistency
 * @param {Object} metrics - Risk-adjusted metrics
 * @returns {number} Composite score (0-1)
 */
function calcCompositeRiskScore(metrics) {
  // Normalize each metric to 0-1 range
  const sharpeNorm = Math.max(0, Math.min(1, (metrics.sharpe + 2) / 4)); // -2 to +2 → 0 to 1
  const sortinoNorm = Math.max(0, Math.min(1, (metrics.sortino + 3) / 6)); // -3 to +3 → 0 to 1
  const calmarNorm = Math.max(0, Math.min(1, (metrics.calmar + 2) / 4)); // -2 to +2 → 0 to 1
  const ddScore = 1 - Math.min(1, metrics.maxDrawdown * 3); // 0% DD = 1, 33%+ DD = 0

  return (
    sharpeNorm * 0.30 +
    sortinoNorm * 0.20 +
    calmarNorm * 0.20 +
    ddScore * 0.15 +
    metrics.consistency * 0.15
  );
}

/**
 * Tune adaptive weights for all strategies based on current regime
 * and risk-adjusted performance metrics.
 *
 * Weight formula (v2):
 *   baseWeight = regime_affinity[strategy] (0-1)
 *   riskScore = compositeRiskScore (0-1)
 *   newWeight = baseWeight * 0.5 + riskScore * 0.3 + historicalWeight * 0.2
 *
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

    // Fetch risk-adjusted metrics for this strategy
    const riskMetrics = await getRiskAdjustedMetrics(ew.strategy);
    const riskScore = calcCompositeRiskScore(riskMetrics);

    // Blend: 50% regime-based, 30% risk-adjusted, 20% historical performance
    const historicalWeight = Number(ew.weight || 0.5);
    const newWeight = baseWeight * 0.5 + riskScore * 0.3 + historicalWeight * 0.2;

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
          blend_ratio: { regime: 0.5, risk_adjusted: 0.3, historical: 0.2 },
          risk_metrics: {
            sharpe: Number(riskMetrics.sharpe.toFixed(4)),
            sortino: Number(riskMetrics.sortino.toFixed(4)),
            max_drawdown: Number(riskMetrics.maxDrawdown.toFixed(4)),
            calmar: Number(riskMetrics.calmar.toFixed(4)),
            consistency: Number(riskMetrics.consistency.toFixed(4)),
            composite_risk_score: Number(riskScore.toFixed(4)),
          },
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
            blend_ratio: { regime: 0.5, risk_adjusted: 0.3, historical: 0.2 },
          },
        });

      if (!insertErr) updated++;
    }
  }

  logger.info(`[weight-tuner] Updated ${updated} weights for regime=${regime.regime}`);
  return updated;
}
