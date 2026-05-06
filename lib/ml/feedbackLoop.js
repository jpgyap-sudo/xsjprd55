// ============================================================
// Feedback Loop — xsjprd55 ML Loop v2
// Receives mock trading feedback, scores strategies, promotes/rejects.
// Now writes through Supabase adapter (with SQLite fallback).
// v2: Uses promotion gate score, expectancy-based promotion.
// ============================================================

import { db } from './db.js';
import { saveMockStrategyFeedback, markProposalPromoted, markProposalRejected, upsertStrategyLifecycle } from './supabase-db.js';

/**
 * @typedef {Object} StrategyFeedbackInput
 * @property {string} strategyName
 * @property {number} trades
 * @property {number} wins
 * @property {number} losses
 * @property {number} totalPnlUsd
 * @property {number} maxDrawdownPct
 * @property {number} [expectancy]
 * @property {number} [profitFactor]
 */

const PROMOTE_TRADES_MIN = 30;
const PROMOTE_WIN_RATE = 0.54;
const PROMOTE_PNL_MIN = 0;
const REJECT_WIN_RATE = 0.40;

/**
 * Compute feedback score from performance metrics.
 * Uses expectancy-weighted formula instead of pure win rate.
 * @param {StrategyFeedbackInput} f
 * @returns {number}
 */
function scoreFeedback(f) {
  const activity = Math.min(f.trades / PROMOTE_TRADES_MIN, 1.0);
  const winRate = f.trades > 0 ? f.wins / f.trades : 0;
  const pnlScore = Math.tanh(f.totalPnlUsd / 1000);
  const expectancy = f.expectancy || 0;
  const profitFactor = f.profitFactor || 0;

  // Expectancy component: positive expectancy is a strong signal
  // Scale: tanh(expectancy * 5) maps expectancy to [-1, 1]
  const expectancyScore = Math.tanh(expectancy * 5);

  // Profit factor component: cap at 3.0 for scoring
  const pfScore = Math.min(profitFactor / 3, 1);

  const sharpeLike = f.maxDrawdownPct > 0
    ? (f.totalPnlUsd / f.trades) / (f.maxDrawdownPct * 100)
    : 0;
  const ddPenalty = Math.tanh(f.maxDrawdownPct / 10);

  const score = activity * (
    (0.25 * pnlScore) +
    (0.15 * winRate) +
    (0.20 * expectancyScore) +
    (0.15 * pfScore) +
    (0.15 * Math.tanh(sharpeLike)) -
    (0.10 * ddPenalty)
  );

  return Number(score.toFixed(4));
}

/**
 * Record mock trading feedback for a strategy.
 * Auto-promotes or rejects based on thresholds.
 * Uses expectancy as primary signal quality metric.
 * @param {StrategyFeedbackInput} input
 * @returns {{score:number, promoted:boolean, rejected:boolean}}
 */
export async function recordMockFeedback(input) {
  const score = scoreFeedback(input);
  const winRate = input.trades > 0 ? input.wins / input.trades : 0;
  const expectancy = input.expectancy || 0;

  let promoted = false;
  let rejected = false;

  // Promote by expectancy, not win rate alone
  // A 45% WR strategy with 2.5R avg win is better than 60% WR with tiny wins
  const hasPositiveExpectancy = expectancy > 0;
  const hasEnoughTrades = input.trades >= PROMOTE_TRADES_MIN;
  const hasPositivePnl = input.totalPnlUsd > PROMOTE_PNL_MIN;

  if (hasEnoughTrades && hasPositiveExpectancy && hasPositivePnl && winRate >= PROMOTE_WIN_RATE) {
    promoted = true;
  } else if (hasEnoughTrades && winRate < REJECT_WIN_RATE) {
    rejected = true;
  }

  // Try Supabase first
  try {
    await saveMockStrategyFeedback({
      strategyName: input.strategyName,
      trades: input.trades,
      wins: input.wins,
      losses: input.losses,
      totalPnlUsd: input.totalPnlUsd,
      maxDrawdownPct: input.maxDrawdownPct,
      feedbackScore: score,
      promoted,
    });
  } catch (e) {
    db.prepare(`
      INSERT INTO mock_strategy_feedback
        (strategy_name, trades, wins, losses, total_pnl_usd, max_drawdown_pct, feedback_score, promoted, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(strategy_name) DO UPDATE SET
        trades = ?,
        wins = ?,
        losses = ?,
        total_pnl_usd = ?,
        max_drawdown_pct = ?,
        feedback_score = ?,
        promoted = MAX(promoted, ?),
        updated_at = datetime('now')
    `).run(
      input.strategyName, input.trades, input.wins, input.losses,
      input.totalPnlUsd, input.maxDrawdownPct, score, promoted ? 1 : 0,
      input.trades, input.wins, input.losses,
      input.totalPnlUsd, input.maxDrawdownPct, score, promoted ? 1 : 0
    );
  }

  // Sync promotion to strategy_proposals if it exists
  if (promoted) {
    try { await markProposalPromoted(input.strategyName); }
    catch (e) { db.prepare(`UPDATE strategy_proposals SET promoted = 1 WHERE name = ?`).run(input.strategyName); }
  }
  if (rejected) {
    try { await markProposalRejected(input.strategyName); }
    catch (e) { db.prepare(`UPDATE strategy_proposals SET rejected = 1 WHERE name = ?`).run(input.strategyName); }
  }

  return { score, promoted, rejected };
}

/**
 * Early-promote a strategy from backtest results.
 * Uses promotion gate score as primary metric, with expectancy, profit factor, and drawdown.
 * @param {string} strategyName
 * @param {{winRate:number, totalReturnPct:number, trades:number, expectancy?:number, profitFactor?:number, maxDrawdownPct?:number, promotionGateScore?:number}} metrics
 */
export async function promoteStrategy(strategyName, metrics) {
  // Use promotion gate score if available, otherwise compute from metrics
  const gateScore = metrics.promotionGateScore || 0;
  const expectancy = metrics.expectancy || 0;
  const profitFactor = metrics.profitFactor || 1;
  const maxDd = metrics.maxDrawdownPct || 0;

  // Composite score: gate score (primary) + expectancy + profit factor + trade count
  const expectancyScore = Math.tanh(expectancy * 5);
  const pfScore = Math.min(profitFactor / 3, 1);
  const ddPenalty = Math.tanh(maxDd / 20);
  const tradeScore = Math.min((metrics.trades || 0) / 100, 1);

  const score = gateScore > 0
    ? gateScore // Use gate score directly when available (it's already comprehensive)
    : Number((
        (metrics.winRate * 0.25) +
        (Math.tanh(metrics.totalReturnPct / 50) * 0.20) +
        (Math.min(metrics.trades / 10, 1) * 0.15) +
        (expectancyScore * 0.20) +
        (pfScore * 0.10) +
        (tradeScore * 0.10) -
        (ddPenalty * 0.10)
      ).toFixed(4));

  const wins = Math.round((metrics.trades || 0) * (metrics.winRate || 0));

  try {
    await saveMockStrategyFeedback({
      strategyName,
      trades: metrics.trades || 0,
      wins,
      losses: (metrics.trades || 0) - wins,
      totalPnlUsd: (metrics.totalReturnPct || 0) * 10,
      maxDrawdownPct: maxDd,
      feedbackScore: Number(score.toFixed(4)),
      promoted: true,
    });
  } catch (e) {
    db.prepare(`
      INSERT INTO mock_strategy_feedback
        (strategy_name, trades, wins, losses, total_pnl_usd, max_drawdown_pct, feedback_score, promoted, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(strategy_name) DO UPDATE SET
        trades = MAX(trades, ?),
        wins = MAX(wins, ?),
        feedback_score = MAX(feedback_score, ?),
        promoted = MAX(promoted, 1),
        updated_at = datetime('now')
    `).run(
      strategyName, metrics.trades || 0, wins, 0,
      (metrics.totalReturnPct || 0) * 10, maxDd, Number(score.toFixed(4)),
      metrics.trades || 0, wins, Number(score.toFixed(4))
    );
  }

  try { await markProposalPromoted(strategyName); }
  catch (e) { db.prepare(`UPDATE strategy_proposals SET promoted = 1 WHERE name = ?`).run(strategyName); }

  // Track lifecycle with extended metrics
  try {
    await upsertStrategyLifecycle({
      strategyName,
      status: 'promoted',
      historicalBacktestScore: score,
      mockTradingScore: 0,
      approvedForMock: true,
      promotionGateScore: gateScore,
      promotionGateFailures: null,
    });
  } catch (e) {
    db.prepare(`
      INSERT INTO strategy_lifecycle (strategy_name, status, historical_backtest_score, mock_trading_score, approved_for_mock, promotion_gate_score, created_at, updated_at)
      VALUES (?, 'promoted', ?, 0, 1, ?, datetime('now'), datetime('now'))
      ON CONFLICT(strategy_name) DO UPDATE SET
        status = 'promoted', historical_backtest_score = MAX(historical_backtest_score, ?), promotion_gate_score = MAX(promotion_gate_score, ?), updated_at = datetime('now')
    `).run(strategyName, score, gateScore, score, gateScore);
  }

  return { promoted: true, score: Number(score.toFixed(4)) };
}

/**
 * Get all currently promoted strategies.
 * @returns {Array<{name:string, score:number, trades:number, winRate:number}>}
 */
export function getPromotedStrategies() {
  const rows = db.prepare(`
    SELECT strategy_name, feedback_score, trades, wins, losses, total_pnl_usd
    FROM mock_strategy_feedback
    WHERE promoted = 1
    ORDER BY feedback_score DESC
  `).all();

  return rows.map((r) => ({
    name: r.strategy_name,
    score: r.feedback_score,
    trades: r.trades,
    winRate: r.trades > 0 ? Number((r.wins / r.trades).toFixed(3)) : 0,
    totalPnl: r.total_pnl_usd,
  }));
}
