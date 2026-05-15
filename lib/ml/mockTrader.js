// ============================================================
// Mock Trader — xsjprd55 ML Loop
// $1,000,000 paper account. Tests strategies, tracks stats.
// v2: Uses shared pnl-calculator.js, adaptive leverage,
//     proper position sizing, balance checks, concentration limits.
// ============================================================

import { db } from './db.js';
import { runStrategyLab, STRATEGIES } from './strategies.js';
import { buildFeatures } from './features.js';
import { predictMlProbability } from './model.js';
import { calculatePnl } from '../backtest/pnl-calculator.js';

/**
 * @typedef {Object} MockTrade
 * @property {number} id
 * @property {string} created_at
 * @property {string} symbol
 * @property {string} strategy_name
 * @property {'LONG'|'SHORT'} side
 * @property {number} entry_price
 * @property {number} size_usd
 * @property {number} leverage
 * @property {number} take_profit_pct
 * @property {number} stop_loss_pct
 * @property {'OPEN'|'CLOSED'} status
 * @property {number|null} exit_price
 * @property {number|null} pnl_usd
 * @property {number|null} pnl_pct
 */

const DEFAULT_TP = 2.0;
const DEFAULT_SL = 1.0;
const MAX_POSITION_PCT = 0.05; // 5% of balance per trade
const MAX_SYMBOL_EXPOSURE_PCT = 0.15; // 15% of balance per symbol
const MIN_CONFIDENCE = 0.35;

/**
 * Get adaptive leverage for a strategy based on historical performance.
 * Uses local SQLite mock_strategy_stats table (Kelly-like adjustment).
 * @param {string} strategyName
 * @returns {{leverage:number, reason:string}}
 */
function getAdaptiveLeverage(strategyName) {
  try {
    const stats = db.prepare(`
      SELECT trades, wins, total_pnl_usd
      FROM mock_strategy_stats
      WHERE strategy_name = ?
    `).get(strategyName);

    if (!stats || stats.trades < 5) {
      return { leverage: 2, reason: 'insufficient_history' };
    }

    const winRate = stats.trades > 0 ? stats.wins / stats.trades : 0;
    const avgPnl = stats.trades > 0 ? stats.total_pnl_usd / stats.trades : 0;

    // Kelly-like leverage adjustment
    let leverage = 2;
    if (winRate > 0.65 && avgPnl > 0) leverage = 5;
    else if (winRate > 0.55 && avgPnl > 0) leverage = 3;
    else if (winRate < 0.4) leverage = 1;
    else if (winRate < 0.5) leverage = 1;

    return {
      leverage,
      reason: `wr=${(winRate * 100).toFixed(0)}%, avgPnl=$${avgPnl.toFixed(0)}`,
    };
  } catch (e) {
    return { leverage: 2, reason: 'error_fallback' };
  }
}

/**
 * Check if opening more positions on a symbol would exceed concentration limit.
 * @param {string} symbol
 * @param {number} newSizeUsd
 * @param {number} balance
 * @returns {{allowed:boolean, reason?:string}}
 */
function checkSymbolConcentration(symbol, newSizeUsd, balance) {
  try {
    const openPositions = db.prepare(`
      SELECT COALESCE(SUM(size_usd), 0) as total_open
      FROM mock_trades
      WHERE symbol = ? AND status = 'OPEN'
    `).get(symbol);

    const currentExposure = openPositions?.total_open || 0;
    const newExposure = currentExposure + newSizeUsd;
    const exposurePct = newExposure / balance;

    if (exposurePct > MAX_SYMBOL_EXPOSURE_PCT) {
      return {
        allowed: false,
        reason: `symbol ${symbol} exposure ${(exposurePct * 100).toFixed(1)}% exceeds max ${(MAX_SYMBOL_EXPOSURE_PCT * 100).toFixed(0)}%`,
      };
    }

    return { allowed: true };
  } catch (e) {
    return { allowed: true }; // Allow on error (fail open)
  }
}

/**
 * Choose up to maxTrades mock trades from strategy lab results.
 * @param {import('./features.js').MarketRawInput} input
 * @param {number} [maxTrades=3]
 * @returns {MockTrade[]}
 */
export function chooseMockTrades(input, maxTrades = 3) {
  const decisions = runStrategyLab(input)
    .filter((d) => d.side !== 'NONE' && d.confidence >= MIN_CONFIDENCE);

  const mlProb = predictMlProbability(buildFeatures(input));

  const scored = decisions.map((d) => ({
    ...d,
    // Penalize untrained model: when mlProb is null, reduce confidence by 20%
    combinedScore: d.confidence * (mlProb !== null ? (mlProb * 0.5 + 0.5) : 0.8),
  }));

  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  const account = db.prepare(`SELECT balance_usd FROM mock_account WHERE id = 1`).get();
  const balance = account?.balance_usd || 1_000_000;

  return scored.slice(0, maxTrades).map((d) => {
    // Fix: Scale position size properly — use confidence as a multiplier
    // Base risk: 2% of balance, scaled by confidence (0.35→0.7%, 1.0→2.0%)
    // Cap at MAX_POSITION_PCT (5%) for safety
    const baseRiskPct = 0.02 * d.confidence;
    const size = Math.min(balance * MAX_POSITION_PCT, balance * baseRiskPct);

    const { leverage } = getAdaptiveLeverage(d.strategy);

    return {
      id: 0, // assigned on open
      created_at: new Date().toISOString(),
      symbol: input.symbol,
      strategy_name: d.strategy,
      side: d.side,
      entry_price: input.price,
      size_usd: Math.round(size),
      leverage,
      take_profit_pct: DEFAULT_TP,
      stop_loss_pct: DEFAULT_SL,
      status: 'OPEN',
      exit_price: null,
      pnl_usd: null,
      pnl_pct: null,
    };
  });
}

/**
 * Open mock trades and deduct balance.
 * Includes balance sufficiency check and symbol concentration check.
 * @param {import('./features.js').MarketRawInput} input
 * @param {number} [maxTrades=3]
 * @returns {MockTrade[]}
 */
export function openMockTrades(input, maxTrades = 3) {
  const trades = chooseMockTrades(input, maxTrades);
  if (trades.length === 0) return [];

  const account = db.prepare(`SELECT balance_usd FROM mock_account WHERE id = 1`).get();
  const balance = account?.balance_usd || 1_000_000;
  const totalSize = trades.reduce((s, t) => s + t.size_usd, 0);

  // Item 3: Balance check — ensure sufficient funds
  if (totalSize > balance) {
    // Scale down proportionally or reject
    const scaleFactor = balance / totalSize;
    for (const t of trades) {
      t.size_usd = Math.round(t.size_usd * scaleFactor * 0.95); // 5% buffer
    }
    const adjustedTotal = trades.reduce((s, t) => s + t.size_usd, 0);
    if (adjustedTotal > balance) return []; // Still can't afford, skip
  }

  // Item 4: Symbol concentration check
  const symbol = input.symbol;
  const concentrationCheck = checkSymbolConcentration(symbol, totalSize, balance);
  if (!concentrationCheck.allowed) {
    return []; // Skip this batch to avoid over-concentration
  }

  const insert = db.prepare(`
    INSERT INTO mock_trades
      (created_at, symbol, strategy_name, side, entry_price, size_usd, leverage, take_profit_pct, stop_loss_pct, status, rationale_json)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
  `);

  const deduct = db.prepare(`
    UPDATE mock_account
    SET balance_usd = balance_usd - ?,
        updated_at = datetime('now')
    WHERE id = 1
  `);

  const adjustedTotalSize = trades.reduce((s, t) => s + t.size_usd, 0);

  db.transaction(() => {
    for (const t of trades) {
      const result = insert.run(
        t.created_at, t.symbol, t.strategy_name, t.side,
        t.entry_price, t.size_usd, t.leverage, t.take_profit_pct, t.stop_loss_pct,
        JSON.stringify({ combinedScore: t.combinedScore })
      );
      t.id = Number(result.lastInsertRowid);
    }
    deduct.run(adjustedTotalSize);
  })();

  return trades;
}

/**
 * Close a mock trade at exitPrice, update balance + stats.
 * Uses shared pnl-calculator.js for consistent PnL math.
 * @param {number} tradeId
 * @param {number} exitPrice
 * @returns {MockTrade|null}
 */
export function closeMockTrade(tradeId, exitPrice) {
  const trade = db.prepare(`SELECT * FROM mock_trades WHERE id = ?`).get(tradeId);
  if (!trade || trade.status === 'CLOSED') return null;

  // Item 2: Use shared pnl-calculator.js instead of inline math
  const pnlResult = calculatePnl({
    side: trade.side,
    entryPrice: trade.entry_price,
    exitPrice,
    leverage: trade.leverage,
    positionSizeUsd: trade.size_usd,
    feePct: 0, // Mock trading has no fees
  });

  const pnlUsd = pnlResult.pnlUsd;
  const pnlPct = pnlResult.pnlPct;

  db.transaction(() => {
    db.prepare(`
      UPDATE mock_trades
      SET status = 'CLOSED', exit_price = ?, pnl_usd = ?, pnl_pct = ?
      WHERE id = ?
    `).run(exitPrice, pnlUsd, pnlPct, tradeId);

    db.prepare(`
      UPDATE mock_account
      SET balance_usd = balance_usd + ? + ?,
          peak_balance_usd = MAX(peak_balance_usd, balance_usd + ? + ?),
          updated_at = datetime('now')
      WHERE id = 1
    `).run(trade.size_usd, pnlUsd, trade.size_usd, pnlUsd);

    // Update per-strategy stats
    const win = pnlUsd > 0 ? 1 : 0;
    const loss = pnlUsd <= 0 ? 1 : 0;
    db.prepare(`
      INSERT INTO mock_strategy_stats (strategy_name, trades, wins, losses, total_pnl_usd, updated_at)
      VALUES (?, 1, ?, ?, ?, datetime('now'))
      ON CONFLICT(strategy_name) DO UPDATE SET
        trades = trades + 1,
        wins = wins + ?,
        losses = losses + ?,
        total_pnl_usd = total_pnl_usd + ?,
        updated_at = datetime('now')
    `).run(trade.strategy_name, win, loss, pnlUsd, win, loss, pnlUsd);
  })();

  return { ...trade, status: 'CLOSED', exit_price: exitPrice, pnl_usd: pnlUsd, pnl_pct: pnlPct };
}

/**
 * Get current mock trading dashboard stats.
 * Enhanced with drawdown, win rate, and Sharpe-like ratio.
 * @returns {{balance:number, peak:number, drawdownPct:number, openTrades:MockTrade[], closedStats:any[], summary:object}}
 */
export function getMockDashboard() {
  const account = db.prepare(`SELECT * FROM mock_account WHERE id = 1`).get();
  const balance = account?.balance_usd || 0;
  const peak = account?.peak_balance_usd || 0;
  const drawdownPct = peak > 0 ? ((peak - balance) / peak) * 100 : 0;

  const openTrades = db.prepare(`SELECT * FROM mock_trades WHERE status = 'OPEN' ORDER BY created_at DESC`).all();
  const closedStats = db.prepare(`
    SELECT strategy_name,
           COUNT(*) as trades,
           SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) as losses,
           SUM(pnl_usd) as total_pnl,
           AVG(pnl_pct) as avg_return
    FROM mock_trades
    WHERE status = 'CLOSED'
    GROUP BY strategy_name
  `).all();

  // Overall summary metrics
  const allClosed = db.prepare(`
    SELECT COUNT(*) as total_trades,
           SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) as total_wins,
           SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) as total_losses,
           SUM(pnl_usd) as total_pnl,
           AVG(pnl_pct) as avg_return
    FROM mock_trades
    WHERE status = 'CLOSED'
  `).get();

  const totalTrades = allClosed?.total_trades || 0;
  const totalWins = allClosed?.total_wins || 0;
  const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;
  const totalPnl = allClosed?.total_pnl || 0;

  // Simple Sharpe-like ratio: avg return / std dev of returns
  let sharpeLike = 0;
  if (totalTrades > 1) {
    const returns = db.prepare(`SELECT pnl_pct FROM mock_trades WHERE status = 'CLOSED' AND pnl_pct IS NOT NULL`).all();
    if (returns.length > 1) {
      const avgRet = returns.reduce((s, r) => s + (r.pnl_pct || 0), 0) / returns.length;
      const variance = returns.reduce((s, r) => s + ((r.pnl_pct || 0) - avgRet) ** 2, 0) / (returns.length - 1);
      const stdDev = Math.sqrt(variance);
      sharpeLike = stdDev > 0 ? (avgRet / stdDev) * Math.sqrt(365) : 0; // Annualized
    }
  }

  return {
    balance,
    peak,
    drawdownPct: Number(drawdownPct.toFixed(2)),
    openTrades,
    closedStats,
    summary: {
      totalTrades,
      winRate: Number(winRate.toFixed(4)),
      totalPnl: Number(totalPnl.toFixed(2)),
      avgReturn: Number((allClosed?.avg_return || 0).toFixed(4)),
      sharpeLike: Number(sharpeLike.toFixed(4)),
    },
  };
}
