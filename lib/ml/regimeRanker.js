// ============================================================
// Regime-Aware Strategy Ranker
// Ranks strategies by market regime: trend, chop, high volatility,
// liquidation cascade, news risk. A strategy is promoted only for
// the regimes where it actually performs.
// ============================================================

import { db } from './db.js';
import { logger } from '../logger.js';

/**
 * Market regime types.
 */
export const REGIMES = {
  TREND: 'trend',
  CHOP: 'chop',
  HIGH_VOLATILITY: 'high_volatility',
  LIQUIDATION_CASCADE: 'liquidation_cascade',
  NEWS_RISK: 'news_risk',
  LOW_VOLATILITY: 'low_volatility',
  UNKNOWN: 'unknown',
};

/**
 * Detect the current market regime from input features.
 * @param {Object} input — { volatilityPct, btcTrendScore, fundingRate, liquidationImbalance, socialSentiment, newsSentiment }
 * @returns {string}
 */
export function detectRegime(input) {
  const vol = Math.abs(input.volatilityPct ?? 0);
  const trend = Math.abs(input.btcTrendScore ?? 0);
  const funding = input.fundingRate ?? 0;
  const liqImbalance = Math.abs(input.liquidationImbalance ?? 0);
  const newsSentiment = Math.abs(input.newsSentiment ?? 0);

  // High volatility
  if (vol > 5) return REGIMES.HIGH_VOLATILITY;

  // Liquidation cascade
  if (liqImbalance > 0.3 && vol > 3) return REGIMES.LIQUIDATION_CASCADE;

  // News risk
  if (newsSentiment > 0.4) return REGIMES.NEWS_RISK;

  // Trend
  if (trend > 0.02 && vol > 1) return REGIMES.TREND;

  // Low volatility
  if (vol < 0.5) return REGIMES.LOW_VOLATILITY;

  // Chop (low trend, moderate vol)
  if (trend < 0.01) return REGIMES.CHOP;

  return REGIMES.UNKNOWN;
}

/**
 * Record a strategy's performance in a specific regime.
 * @param {string} strategyName
 * @param {string} regime
 * @param {{pnlPct:number, winRate:number, trades:number}} performance
 */
export function recordRegimePerformance(strategyName, regime, performance) {
  try {
    db.prepare(`
      INSERT INTO strategy_regime_performance (strategy_name, regime, total_trades, wins, losses, total_pnl_pct, win_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(strategy_name, regime) DO UPDATE SET
        total_trades = total_trades + ?,
        wins = wins + ?,
        losses = losses + ?,
        total_pnl_pct = total_pnl_pct + ?,
        win_rate = CAST(wins AS REAL) / CAST((wins + losses) AS REAL),
        updated_at = datetime('now')
    `).run(
      strategyName,
      regime,
      performance.trades || 1,
      Math.round((performance.trades || 1) * (performance.winRate || 0)),
      Math.round((performance.trades || 1) * (1 - (performance.winRate || 0))),
      performance.pnlPct || 0,
      performance.winRate || 0,
      performance.trades || 1,
      Math.round((performance.trades || 1) * (performance.winRate || 0)),
      Math.round((performance.trades || 1) * (1 - (performance.winRate || 0))),
      performance.pnlPct || 0
    );
  } catch (e) {
    logger.warn(`[REGIME] Failed to record regime performance for ${strategyName}: ${e.message}`);
  }
}

/**
 * Get a strategy's best-performing regimes.
 * @param {string} strategyName
 * @param {number} [limit=3]
 * @returns {Array<{regime:string, winRate:number, totalPnlPct:number, trades:number}>}
 */
export function getBestRegimes(strategyName, limit = 3) {
  try {
    return db.prepare(`
      SELECT regime, win_rate as winRate, total_pnl_pct as totalPnlPct, total_trades as trades
      FROM strategy_regime_performance
      WHERE strategy_name = ? AND total_trades >= 5
      ORDER BY win_rate DESC, total_pnl_pct DESC
      LIMIT ?
    `).all(strategyName, limit);
  } catch (e) {
    return [];
  }
}

/**
 * Check if a strategy is suitable for the current regime.
 * @param {string} strategyName
 * @param {string} currentRegime
 * @param {number} [minWinRate=0.45]
 * @returns {{suitable:boolean, regimeWinRate:number, bestRegimes:Array}}
 */
export function isStrategySuitableForRegime(strategyName, currentRegime, minWinRate = 0.45) {
  try {
    const record = db.prepare(`
      SELECT win_rate as winRate, total_trades as trades, total_pnl_pct as totalPnlPct
      FROM strategy_regime_performance
      WHERE strategy_name = ? AND regime = ?
    `).get(strategyName, currentRegime);

    if (!record || record.trades < 3) {
      return { suitable: true, regimeWinRate: 0, bestRegimes: getBestRegimes(strategyName) };
    }

    return {
      suitable: record.winRate >= minWinRate,
      regimeWinRate: record.winRate,
      bestRegimes: getBestRegimes(strategyName),
    };
  } catch (e) {
    return { suitable: true, regimeWinRate: 0, bestRegimes: [] };
  }
}

/**
 * Get regime-adjusted promotion score.
 * @param {string} strategyName
 * @param {string} currentRegime
 * @param {number} baseScore — original promotion score (0..1)
 * @returns {number}
 */
export function getRegimeAdjustedScore(strategyName, currentRegime, baseScore) {
  const { suitable, regimeWinRate } = isStrategySuitableForRegime(strategyName, currentRegime);
  if (!suitable) {
    // Penalize strategies that perform poorly in current regime
    const penalty = Math.max(0, 0.45 - (regimeWinRate || 0)) * 0.5;
    return Math.max(0, baseScore - penalty);
  }
  // Bonus for strategies proven in current regime
  const bonus = Math.min(0.1, (regimeWinRate || 0) * 0.1);
  return Math.min(1, baseScore + bonus);
}

/**
 * Get all regime performance data for a strategy.
 * @param {string} strategyName
 * @returns {Array}
 */
export function getAllRegimeData(strategyName) {
  try {
    return db.prepare(`
      SELECT * FROM strategy_regime_performance WHERE strategy_name = ? ORDER BY total_trades DESC
    `).all(strategyName);
  } catch (e) {
    return [];
  }
}
