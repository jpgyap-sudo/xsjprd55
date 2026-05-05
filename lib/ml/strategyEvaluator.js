// ============================================================
// Strategy Evaluator — Assello Extension
// Ranks strategies by composite score using performance metrics.
// ============================================================

import { db } from './db.js';
import { calculatePerformanceMetrics } from './performanceMetrics.js';
import { logger } from '../logger.js';

/**
 * @typedef {Object} RankedStrategy
 * @property {string} name
 * @property {number} compositeScore
 * @property {number} winRate
 * @property {number} sharpeRatio
 * @property {number} profitFactor
 * @property {number} maxDrawdownPct
 * @property {number} totalPnl
 * @property {number} trades
 * @property {string} tier 'S'|'A'|'B'|'C'|'F'
 */

const TIER_THRESHOLDS = [
  { tier: 'S', minScore: 0.85 },
  { tier: 'A', minScore: 0.70 },
  { tier: 'B', minScore: 0.55 },
  { tier: 'C', minScore: 0.40 },
  { tier: 'F', minScore: 0 },
];

/**
 * Compute composite score from raw metrics.
 * Weights: Sharpe 30%, Profit Factor 25%, Win Rate 20%, Drawdown penalty 15%, Activity 10%
 * @param {{winRate:number, sharpeRatio:number, profitFactor:number, maxDrawdownPct:number, trades:number}} m
 * @returns {number}
 */
export function computeCompositeScore(m) {
  const sharpe = Math.max(Math.min(m.sharpeRatio, 3), -3);
  const pf = Math.max(Math.min(m.profitFactor, 5), 0);
  const wr = Math.max(Math.min(m.winRate, 1), 0);
  const dd = Math.max(Math.min(m.maxDrawdownPct, 50), 0);
  const activity = Math.min(m.trades / 30, 1);

  const ddPenalty = dd / 50; // 0..1

  const score =
    (0.30 * (sharpe / 3)) +
    (0.25 * (pf / 5)) +
    (0.20 * wr) +
    (0.15 * (1 - ddPenalty)) +
    (0.10 * activity);

  return Number(score.toFixed(4));
}

/**
 * Assign tier based on composite score.
 * @param {number} score
 * @returns {string}
 */
export function assignTier(score) {
  for (const t of TIER_THRESHOLDS) {
    if (score >= t.minScore) return t.tier;
  }
  return 'F';
}

/**
 * Rank all strategies from mock trading stats + backtest results.
 * @returns {RankedStrategy[]}
 */
export function rankAllStrategies() {
  // 1. Load mock trading stats (with error handling for missing table)
  let mockStats = [];
  try {
    mockStats = db.prepare(`
      SELECT strategy_name,
             SUM(trades) as trades,
             SUM(wins) as wins,
             SUM(losses) as losses,
             SUM(total_pnl_usd) as total_pnl
      FROM mock_strategy_stats
      GROUP BY strategy_name
    `).all();
  } catch (e) {
    logger.warn(`[STRATEGY-EVALUATOR] mock_strategy_stats table not available: ${e.message}`);
    mockStats = [];
  }

  // 2. Load backtest results
  const backtests = db.prepare(`
    SELECT strategy_name,
           AVG(win_rate) as win_rate,
           AVG(sharpe_ratio) as sharpe_ratio,
           AVG(max_drawdown_pct) as max_drawdown_pct,
           AVG(profit_factor) as profit_factor,
           SUM(total_trades) as total_trades
    FROM backtest_results
    GROUP BY strategy_name
  `).all();

  const map = new Map();

  // Merge mock stats
  for (const row of mockStats) {
    const wr = row.trades > 0 ? row.wins / row.trades : 0;
    map.set(row.strategy_name, {
      name: row.strategy_name,
      trades: row.trades,
      winRate: wr,
      sharpeRatio: 0,
      profitFactor: row.losses > 0 ? (row.wins * Math.abs(row.total_pnl / (row.wins || 1))) / (row.losses * Math.abs(row.total_pnl / (row.losses || 1))) : 1,
      maxDrawdownPct: 0,
      totalPnl: row.total_pnl,
    });
  }

  // Merge backtest results
  for (const row of backtests) {
    const existing = map.get(row.strategy_name) || {
      name: row.strategy_name,
      trades: 0, winRate: 0, sharpeRatio: 0, profitFactor: 0, maxDrawdownPct: 0, totalPnl: 0,
    };
    existing.trades += row.total_trades || 0;
    existing.winRate = (existing.winRate + (row.win_rate || 0)) / 2;
    existing.sharpeRatio = (existing.sharpeRatio + (row.sharpe_ratio || 0)) / 2;
    existing.profitFactor = (existing.profitFactor + (row.profit_factor || 0)) / 2;
    existing.maxDrawdownPct = Math.max(existing.maxDrawdownPct, row.max_drawdown_pct || 0);
    map.set(row.strategy_name, existing);
  }

  // 3. Compute composite scores and tiers
  const ranked = [];
  for (const entry of map.values()) {
    const composite = computeCompositeScore({
      winRate: entry.winRate,
      sharpeRatio: entry.sharpeRatio,
      profitFactor: entry.profitFactor,
      maxDrawdownPct: entry.maxDrawdownPct,
      trades: entry.trades,
    });
    ranked.push({
      name: entry.name,
      compositeScore: composite,
      winRate: Number(entry.winRate.toFixed(3)),
      sharpeRatio: Number(entry.sharpeRatio.toFixed(3)),
      profitFactor: Number(entry.profitFactor.toFixed(3)),
      maxDrawdownPct: Number(entry.maxDrawdownPct.toFixed(3)),
      totalPnl: Number(entry.totalPnl.toFixed(2)),
      trades: entry.trades,
      tier: assignTier(composite),
    });
  }

  ranked.sort((a, b) => b.compositeScore - a.compositeScore);

  logger.info(`[STRATEGY-EVALUATOR] Ranked ${ranked.length} strategies. Top: ${ranked[0]?.name || 'none'} (S=${ranked[0]?.compositeScore})`);
  return ranked;
}

/**
 * Get top-N strategies by tier filter.
 * @param {number} [n=5]
 * @param {string[]} [tiers=['S','A','B']]
 * @returns {RankedStrategy[]}
 */
export function getTopStrategies(n = 5, tiers = ['S', 'A', 'B']) {
  const all = rankAllStrategies();
  return all.filter((s) => tiers.includes(s.tier)).slice(0, n);
}

/**
 * Auto-promote top-tier strategies to the feedback table.
 * @returns {{promoted:number, names:string[]}}
 */
export function autoPromoteTopStrategies() {
  const top = getTopStrategies(10, ['S', 'A']);
  const promoted = [];

  for (const s of top) {
    try {
      db.prepare(`
        INSERT INTO mock_strategy_feedback (strategy_name, trades, wins, losses, total_pnl_usd, max_drawdown_pct, feedback_score, promoted, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT(strategy_name) DO UPDATE SET
          promoted = MAX(promoted, 1),
          feedback_score = MAX(feedback_score, ?),
          updated_at = datetime('now')
      `).run(
        s.name, s.trades, Math.round(s.trades * s.winRate), Math.round(s.trades * (1 - s.winRate)),
        s.totalPnl, s.maxDrawdownPct, s.compositeScore, s.compositeScore
      );
      promoted.push(s.name);
    } catch (e) {
      logger.warn(`[STRATEGY-EVALUATOR] Auto-promote failed for ${s.name}: ${e.message}`);
    }
  }

  logger.info(`[STRATEGY-EVALUATOR] Auto-promoted ${promoted.length} strategies: ${promoted.join(', ')}`);
  return { promoted: promoted.length, names: promoted };
}
