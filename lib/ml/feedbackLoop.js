// ============================================================
// Feedback Loop — xsjprd55 ML Loop v2
// Receives mock trading feedback, scores strategies, promotes/rejects.
// Now writes through Supabase adapter (with SQLite fallback).
// ============================================================

import { db } from './db.js';
import { saveMockStrategyFeedback, markProposalPromoted, markProposalRejected } from './supabase-db.js';

/**
 * @typedef {Object} StrategyFeedbackInput
 * @property {string} strategyName
 * @property {number} trades
 * @property {number} wins
 * @property {number} losses
 * @property {number} totalPnlUsd
 * @property {number} maxDrawdownPct
 */

const PROMOTE_TRADES_MIN = 30;
const PROMOTE_WIN_RATE = 0.54;
const PROMOTE_PNL_MIN = 0;
const REJECT_WIN_RATE = 0.40;

/**
 * Compute feedback score from performance metrics.
 * @param {StrategyFeedbackInput} f
 * @returns {number}
 */
function scoreFeedback(f) {
  const activity = Math.min(f.trades / PROMOTE_TRADES_MIN, 1.0);
  const winRate = f.trades > 0 ? f.wins / f.trades : 0;
  const pnlScore = Math.tanh(f.totalPnlUsd / 1000); // normalize
  const winScore = winRate;
  const sharpeLike = f.maxDrawdownPct > 0
    ? (f.totalPnlUsd / f.trades) / (f.maxDrawdownPct * 100)
    : 0;
  const ddPenalty = Math.tanh(f.maxDrawdownPct / 10);

  const score = activity * (
    (0.35 * pnlScore) +
    (0.25 * winScore) +
    (0.25 * Math.tanh(sharpeLike)) -
    (0.15 * ddPenalty)
  );

  return Number(score.toFixed(4));
}

/**
 * Record mock trading feedback for a strategy.
 * Auto-promotes or rejects based on thresholds.
 * @param {StrategyFeedbackInput} input
 * @returns {{score:number, promoted:boolean, rejected:boolean}}
 */
export async function recordMockFeedback(input) {
  const score = scoreFeedback(input);
  const winRate = input.trades > 0 ? input.wins / input.trades : 0;

  let promoted = false;
  let rejected = false;

  if (input.trades >= PROMOTE_TRADES_MIN && winRate >= PROMOTE_WIN_RATE && input.totalPnlUsd > PROMOTE_PNL_MIN) {
    promoted = true;
  } else if (input.trades >= PROMOTE_TRADES_MIN && winRate < REJECT_WIN_RATE) {
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
 * Early-promote a strategy from backtest results (lower threshold).
 * @param {string} strategyName
 * @param {{winRate:number, totalReturnPct:number, trades:number}} metrics
 */
export async function promoteStrategy(strategyName, metrics) {
  const score = (metrics.winRate * 0.4) + (Math.tanh(metrics.totalReturnPct / 50) * 0.3) + (Math.min(metrics.trades / 10, 1) * 0.3);
  const wins = Math.round((metrics.trades || 0) * (metrics.winRate || 0));

  try {
    await saveMockStrategyFeedback({
      strategyName,
      trades: metrics.trades || 0,
      wins,
      losses: (metrics.trades || 0) - wins,
      totalPnlUsd: (metrics.totalReturnPct || 0) * 10,
      maxDrawdownPct: 0,
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
      (metrics.totalReturnPct || 0) * 10, 0, Number(score.toFixed(4)),
      metrics.trades || 0, wins, Number(score.toFixed(4))
    );
  }

  try { await markProposalPromoted(strategyName); }
  catch (e) { db.prepare(`UPDATE strategy_proposals SET promoted = 1 WHERE name = ?`).run(strategyName); }

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
