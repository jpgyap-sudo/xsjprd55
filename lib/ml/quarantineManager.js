// ============================================================
// Quarantine Manager
// Adds a `quarantine_testing` stage between `historically_backtested`
// and `approved_for_mock`. New strategies trade tiny paper size
// until they complete 30-50 mock trades with positive expectancy.
// ============================================================

import { db } from './db.js';
import { logger } from '../logger.js';

export const QUARANTINE_DEFAULTS = {
  minMockTrades: 30,
  maxMockTrades: 50,
  minWinRate: 0.45,
  minExpectancy: 0,
  positionSizeMultiplier: 0.3, // 30% of normal mock position size
};

/**
 * Move a strategy into quarantine after passing historical backtest.
 * @param {string} strategyName
 * @param {Object} [opts]
 * @param {number} [opts.positionSizeMultiplier]
 */
export function enterQuarantine(strategyName, opts = {}) {
  const psm = opts.positionSizeMultiplier ?? QUARANTINE_DEFAULTS.positionSizeMultiplier;

  try {
    db.prepare(`
      UPDATE strategy_lifecycle
      SET status = 'quarantine_testing',
          quarantine_position_size_mult = ?,
          quarantine_trades_needed = ?,
          updated_at = datetime('now')
      WHERE strategy_name = ?
    `).run(psm, QUARANTINE_DEFAULTS.minMockTrades, strategyName);

    logger.info(`[QUARANTINE] ${strategyName} entered quarantine (${psm}x position size, need ${QUARANTINE_DEFAULTS.minMockTrades} trades)`);
  } catch (e) {
    logger.warn(`[QUARANTINE] Failed to enter quarantine for ${strategyName}: ${e.message}`);
  }
}

/**
 * Record a mock trade result during quarantine.
 * @param {string} strategyName
 * @param {{pnlPct:number}} trade
 */
export function recordQuarantineTrade(strategyName, trade) {
  try {
    db.prepare(`
      INSERT INTO quarantine_trades (strategy_name, pnl_pct, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(strategyName, trade.pnlPct ?? 0);
  } catch (e) {
    logger.warn(`[QUARANTINE] Failed to record trade for ${strategyName}: ${e.message}`);
  }
}

/**
 * Check if a strategy has completed quarantine and should be promoted.
 * @param {string} strategyName
 * @returns {{completed:boolean, trades:number, winRate:number, expectancy:number, passed:boolean, reasons:string[]}}
 */
export function checkQuarantineStatus(strategyName) {
  const reasons = [];

  // Get quarantine trades
  let trades = [];
  try {
    trades = db.prepare(`
      SELECT pnl_pct FROM quarantine_trades
      WHERE strategy_name = ?
      ORDER BY created_at ASC
    `).all(strategyName);
  } catch (e) {
    return { completed: false, trades: 0, winRate: 0, expectancy: 0, passed: false, reasons: [`DB error: ${e.message}`] };
  }

  const totalTrades = trades.length;
  if (totalTrades < QUARANTINE_DEFAULTS.minMockTrades) {
    return {
      completed: false,
      trades: totalTrades,
      winRate: 0,
      expectancy: 0,
      passed: false,
      reasons: [`Need ${QUARANTINE_DEFAULTS.minMockTrades} trades, have ${totalTrades}`],
    };
  }

  const wins = trades.filter(t => (t.pnl_pct ?? 0) > 0);
  const losses = trades.filter(t => (t.pnl_pct ?? 0) <= 0);
  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / losses.length : 0;
  const expectancy = (winRate * avgWin) + ((1 - winRate) * avgLoss);

  if (winRate < QUARANTINE_DEFAULTS.minWinRate) {
    reasons.push(`Win rate ${(winRate * 100).toFixed(1)}% < ${(QUARANTINE_DEFAULTS.minWinRate * 100).toFixed(0)}%`);
  }
  if (expectancy <= QUARANTINE_DEFAULTS.minExpectancy) {
    reasons.push(`Expectancy ${expectancy.toFixed(4)} <= ${QUARANTINE_DEFAULTS.minExpectancy}`);
  }
  if (totalTrades > QUARANTINE_DEFAULTS.maxMockTrades) {
    reasons.push(`Exceeded max quarantine trades (${totalTrades} > ${QUARANTINE_DEFAULTS.maxMockTrades})`);
  }

  const passed = reasons.length === 0;

  logger.info(
    `[QUARANTINE] ${strategyName}: ${totalTrades}t WR=${(winRate * 100).toFixed(1)}% Exp=${expectancy.toFixed(4)} ` +
    `${passed ? '✅ PASSED' : '❌ FAILED: ' + reasons.join('; ')}`
  );

  return { completed: true, trades: totalTrades, winRate, expectancy, passed, reasons };
}

/**
 * Promote a strategy out of quarantine into approved_for_mock.
 * @param {string} strategyName
 */
export function promoteFromQuarantine(strategyName) {
  try {
    db.prepare(`
      UPDATE strategy_lifecycle
      SET status = 'approved_for_mock',
          approved_for_mock = 1,
          quarantine_passed = 1,
          updated_at = datetime('now')
      WHERE strategy_name = ?
    `).run(strategyName);
    logger.info(`[QUARANTINE] ${strategyName} promoted from quarantine → approved_for_mock`);
  } catch (e) {
    logger.warn(`[QUARANTINE] Failed to promote ${strategyName}: ${e.message}`);
  }
}

/**
 * Reject a strategy from quarantine.
 * @param {string} strategyName
 * @param {string} reason
 */
export function rejectFromQuarantine(strategyName, reason) {
  try {
    db.prepare(`
      UPDATE strategy_lifecycle
      SET status = 'rejected',
          approved_for_mock = 0,
          rejected_reason = ?,
          updated_at = datetime('now')
      WHERE strategy_name = ?
    `).run(`quarantine: ${reason}`, strategyName);
    logger.info(`[QUARANTINE] ${strategyName} rejected from quarantine: ${reason}`);
  } catch (e) {
    logger.warn(`[QUARANTINE] Failed to reject ${strategyName}: ${e.message}`);
  }
}

/**
 * Get all strategies currently in quarantine.
 * @returns {Array<Object>}
 */
export function getQuarantineStrategies() {
  try {
    return db.prepare(`
      SELECT * FROM strategy_lifecycle WHERE status = 'quarantine_testing' ORDER BY updated_at DESC
    `).all();
  } catch (e) {
    return [];
  }
}
