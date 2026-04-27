// ============================================================
// Strategy Lifecycle + Approval Gate — MockTest Architecture
// Research Agent → Historical Backtest → Approved → Mock Trader
// ============================================================

import { db } from './db.js';
import { calculatePerformanceMetrics } from './performanceMetrics.js';
import { logger } from '../logger.js';

/**
 * @typedef {'researched'|'historically_backtested'|'approved_for_mock'|'mock_testing'|'promoted_candidate'|'rejected'} StrategyStatus
 */

/**
 * @typedef {Object} ApprovalCriteria
 * @property {number} minProfitFactor
 * @property {number} minWinRate
 * @property {number} maxDrawdownPct
 * @property {number} minTotalTrades
 */

const DEFAULT_APPROVAL = {
  minProfitFactor: 1.25,
  minWinRate: 0.45,
  maxDrawdownPct: 20,
  minTotalTrades: 50,
};

/**
 * Check if a backtest result passes the approval gate.
 * @param {{profitFactor:number, winRate:number, maxDrawdownPct:number, totalTrades:number}} backtest
 * @param {ApprovalCriteria} [criteria]
 * @returns {{approved:boolean, reasons:string[]}}
 */
export function approveForMock(backtest, criteria = DEFAULT_APPROVAL) {
  const reasons = [];
  let approved = true;

  if ((backtest.profitFactor ?? 0) < criteria.minProfitFactor) {
    approved = false;
    reasons.push(`profitFactor ${backtest.profitFactor?.toFixed(2)} < ${criteria.minProfitFactor}`);
  }
  if ((backtest.winRate ?? 0) < criteria.minWinRate) {
    approved = false;
    reasons.push(`winRate ${(backtest.winRate * 100)?.toFixed(1)}% < ${criteria.minWinRate * 100}%`);
  }
  if ((backtest.maxDrawdownPct ?? 0) > criteria.maxDrawdownPct) {
    approved = false;
    reasons.push(`maxDrawdown ${backtest.maxDrawdownPct?.toFixed(1)}% > ${criteria.maxDrawdownPct}%`);
  }
  if ((backtest.totalTrades ?? 0) < criteria.minTotalTrades) {
    approved = false;
    reasons.push(`trades ${backtest.totalTrades} < ${criteria.minTotalTrades}`);
  }

  return { approved, reasons };
}

/**
 * Initialize lifecycle tracking for a strategy proposal.
 * @param {number} proposalId
 * @param {string} strategyName
 */
export function initLifecycle(proposalId, strategyName) {
  db.prepare(`
    INSERT INTO strategy_lifecycle
      (proposal_id, strategy_name, status, historical_backtest_score, mock_trading_score, approved_for_mock, rejected_reason, created_at, updated_at)
    VALUES
      (?, ?, 'researched', 0, 0, 0, NULL, datetime('now'), datetime('now'))
    ON CONFLICT(strategy_name) DO UPDATE SET
      updated_at = datetime('now')
  `).run(proposalId, strategyName);
}

/**
 * Record historical backtest result and update status.
 * @param {string} strategyName
 * @param {Object} backtest
 * @returns {{approved:boolean, status:StrategyStatus, reasons:string[]}}
 */
export function recordHistoricalBacktest(strategyName, backtest) {
  const metrics = calculatePerformanceMetrics(backtest.trades || []);
  const score = computeLifecycleScore(metrics);
  const { approved, reasons } = approveForMock({
    profitFactor: metrics.profitFactor,
    winRate: metrics.winRate,
    maxDrawdownPct: metrics.maxDrawdownPct,
    totalTrades: metrics.totalTrades,
  });

  const status = approved ? 'approved_for_mock' : 'rejected';

  db.prepare(`
    UPDATE strategy_lifecycle
    SET status = ?,
        historical_backtest_score = ?,
        approved_for_mock = ?,
        rejected_reason = ?,
        updated_at = datetime('now')
    WHERE strategy_name = ?
  `).run(status, score, approved ? 1 : 0, approved ? null : reasons.join('; '), strategyName);

  // Also update proposals table
  db.prepare(`
    UPDATE strategy_proposals
    SET tested = 1,
        promoted = ?,
        rejected = ?
    WHERE name = ?
  `).run(approved ? 1 : 0, approved ? 0 : 1, strategyName);

  logger.info(`[LIFECYCLE] ${strategyName} → ${status} (score=${score.toFixed(3)}, approved=${approved})`);
  return { approved, status, reasons };
}

/**
 * Transition a strategy to mock_testing status.
 * @param {string} strategyName
 */
export function startMockTesting(strategyName) {
  db.prepare(`
    UPDATE strategy_lifecycle
    SET status = 'mock_testing', updated_at = datetime('now')
    WHERE strategy_name = ? AND approved_for_mock = 1
  `).run(strategyName);
}

/**
 * Record mock trading result and promote/reject.
 * @param {string} strategyName
 * @param {number} mockScore
 * @param {{winRate:number, totalPnl:number, trades:number}} metrics
 * @returns {{promoted:boolean, status:StrategyStatus}}
 */
export function recordMockResult(strategyName, mockScore, metrics) {
  const PROMOTE_WIN_RATE = 0.54;
  const PROMOTE_MIN_TRADES = 30;

  const promoted = metrics.trades >= PROMOTE_MIN_TRADES &&
    metrics.winRate >= PROMOTE_WIN_RATE &&
    metrics.totalPnl > 0;

  const status = promoted ? 'promoted_candidate' : 'mock_testing';

  db.prepare(`
    UPDATE strategy_lifecycle
    SET status = ?,
        mock_trading_score = ?,
        updated_at = datetime('now')
    WHERE strategy_name = ?
  `).run(status, mockScore, strategyName);

  if (promoted) {
    db.prepare(`
      INSERT INTO mock_strategy_feedback
        (strategy_name, trades, wins, losses, total_pnl_usd, feedback_score, promoted, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(strategy_name) DO UPDATE SET
        promoted = 1,
        feedback_score = MAX(feedback_score, ?),
        updated_at = datetime('now')
    `).run(
      strategyName, metrics.trades, Math.round(metrics.trades * metrics.winRate),
      Math.round(metrics.trades * (1 - metrics.winRate)), metrics.totalPnl, mockScore, mockScore
    );
  }

  logger.info(`[LIFECYCLE] ${strategyName} → ${status} (mockScore=${mockScore.toFixed(3)}, promoted=${promoted})`);
  return { promoted, status };
}

/**
 * Get all strategies by status.
 * @param {StrategyStatus} [status]
 * @returns {Array<Object>}
 */
export function getStrategiesByStatus(status) {
  if (status) {
    return db.prepare(`SELECT * FROM strategy_lifecycle WHERE status = ? ORDER BY updated_at DESC`).all(status);
  }
  return db.prepare(`SELECT * FROM strategy_lifecycle ORDER BY updated_at DESC`).all();
}

/**
 * Get only approved-for-mock strategies.
 * @returns {string[]}
 */
export function getApprovedStrategies() {
  const rows = db.prepare(`
    SELECT strategy_name FROM strategy_lifecycle WHERE approved_for_mock = 1 AND status != 'rejected'
  `).all();
  return rows.map((r) => r.strategy_name);
}

/**
 * Compute a composite lifecycle score (0..1).
 * @param {import('./performanceMetrics.js').PerformanceReport} metrics
 * @returns {number}
 */
function computeLifecycleScore(metrics) {
  const pf = Math.min(metrics.profitFactor / 3, 1);
  const wr = metrics.winRate;
  const sharpe = Math.min(Math.max(metrics.sharpeRatio, -2) / 2, 1);
  const dd = Math.max(0, 1 - metrics.maxDrawdownPct / 50);
  return Number(((pf * 0.3) + (wr * 0.3) + (sharpe * 0.2) + (dd * 0.2)).toFixed(4));
}
