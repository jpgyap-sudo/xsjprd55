// ============================================================
// Mock Trader — xsjprd55 ML Loop
// $1,000,000 paper account. Tests strategies, tracks stats.
// ============================================================

import { db } from './db.js';
import { runStrategyLab, STRATEGIES } from './strategies.js';
import { buildFeatures } from './features.js';
import { predictMlProbability } from './model.js';

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

/**
 * Choose up to maxTrades mock trades from strategy lab results.
 * @param {import('./features.js').MarketRawInput} input
 * @param {number} [maxTrades=3]
 * @returns {MockTrade[]}
 */
export function chooseMockTrades(input, maxTrades = 3) {
  const decisions = runStrategyLab(input)
    .filter((d) => d.side !== 'NONE' && d.confidence >= 0.35);

  const mlProb = predictMlProbability(buildFeatures(input));

  const scored = decisions.map((d) => ({
    ...d,
    combinedScore: d.confidence * (mlProb !== null ? (mlProb * 0.5 + 0.5) : 1),
  }));

  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  const account = db.prepare(`SELECT balance_usd FROM mock_account WHERE id = 1`).get();
  const balance = account?.balance_usd || 1_000_000;

  return scored.slice(0, maxTrades).map((d) => {
    const size = Math.min(balance * MAX_POSITION_PCT, balance * 0.02 * d.confidence);
    const leverage = d.confidence > 0.7 ? 3 : d.confidence > 0.5 ? 2 : 1;
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
 * @param {import('./features.js').MarketRawInput} input
 * @param {number} [maxTrades=3]
 * @returns {MockTrade[]}
 */
export function openMockTrades(input, maxTrades = 3) {
  const trades = chooseMockTrades(input, maxTrades);
  if (trades.length === 0) return [];

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

  const totalSize = trades.reduce((s, t) => s + t.size_usd, 0);

  db.transaction(() => {
    for (const t of trades) {
      const result = insert.run(
        t.created_at, t.symbol, t.strategy_name, t.side,
        t.entry_price, t.size_usd, t.leverage, t.take_profit_pct, t.stop_loss_pct,
        JSON.stringify({ combinedScore: t.combinedScore })
      );
      t.id = Number(result.lastInsertRowid);
    }
    deduct.run(totalSize);
  })();

  return trades;
}

/**
 * Close a mock trade at exitPrice, update balance + stats.
 * @param {number} tradeId
 * @param {number} exitPrice
 * @returns {MockTrade|null}
 */
export function closeMockTrade(tradeId, exitPrice) {
  const trade = db.prepare(`SELECT * FROM mock_trades WHERE id = ?`).get(tradeId);
  if (!trade || trade.status === 'CLOSED') return null;

  const rawReturn = ((exitPrice - trade.entry_price) / trade.entry_price) * 100;
  const signedReturn = trade.side === 'SHORT' ? -rawReturn : rawReturn;
  const pnlUsd = (trade.size_usd * trade.leverage * signedReturn) / 100;

  db.transaction(() => {
    db.prepare(`
      UPDATE mock_trades
      SET status = 'CLOSED', exit_price = ?, pnl_usd = ?, pnl_pct = ?
      WHERE id = ?
    `).run(exitPrice, pnlUsd, signedReturn, tradeId);

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

  return { ...trade, status: 'CLOSED', exit_price: exitPrice, pnl_usd: pnlUsd, pnl_pct: signedReturn };
}

/**
 * Get current mock trading dashboard stats.
 * @returns {{balance:number, peak:number, openTrades:MockTrade[], closedStats:any[]}}
 */
export function getMockDashboard() {
  const account = db.prepare(`SELECT * FROM mock_account WHERE id = 1`).get();
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

  return {
    balance: account?.balance_usd || 0,
    peak: account?.peak_balance_usd || 0,
    openTrades,
    closedStats,
  };
}
