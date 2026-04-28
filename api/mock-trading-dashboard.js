// ============================================================
// Mock Trading Dashboard API
// Returns paper account stats, open/closed trades, PnL analysis,
// and strategy performance for the mock trading tab.
// ============================================================

import { db } from '../lib/ml/db.js';
import { initMlDb } from '../lib/ml/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  initMlDb();

  try {
    // Account stats
    const account = db.prepare(`SELECT * FROM mock_account WHERE id = 1`).get();

    // Open trades with full details
    const openTrades = db.prepare(`
      SELECT id, created_at, symbol, strategy_name, side, entry_price, size_usd, leverage,
             take_profit_pct, stop_loss_pct, status, rationale_json
      FROM mock_trades
      WHERE status = 'OPEN'
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    // Recent closed trades
    const closedTrades = db.prepare(`
      SELECT id, created_at, symbol, strategy_name, side, entry_price, exit_price, size_usd,
             leverage, pnl_usd, pnl_pct, status
      FROM mock_trades
      WHERE status = 'CLOSED'
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    // Per-strategy performance stats
    const strategyStats = db.prepare(`
      SELECT strategy_name,
             COUNT(*) as trades,
             SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) as losses,
             SUM(pnl_usd) as total_pnl,
             AVG(pnl_pct) as avg_return,
             MAX(pnl_usd) as best_trade,
             MIN(pnl_usd) as worst_trade
      FROM mock_trades
      WHERE status = 'CLOSED'
      GROUP BY strategy_name
      ORDER BY total_pnl DESC
    `).all();

    // Daily PnL summary (last 30 days)
    const dailyPnl = db.prepare(`
      SELECT date(created_at) as day,
             COUNT(*) as trades,
             SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) as wins,
             SUM(pnl_usd) as pnl
      FROM mock_trades
      WHERE status = 'CLOSED'
        AND created_at >= date('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY day DESC
      LIMIT 30
    `).all();

    // Overall win rate & totals
    const totals = db.prepare(`
      SELECT
        COUNT(*) as totalTrades,
        SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) as totalWins,
        SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) as totalLosses,
        SUM(pnl_usd) as totalPnl,
        AVG(pnl_pct) as avgReturn,
        MAX(pnl_usd) as bestTrade,
        MIN(pnl_usd) as worstTrade
      FROM mock_trades
      WHERE status = 'CLOSED'
    `).get();

    // Calculate max drawdown from closed trades sequence
    const allClosed = db.prepare(`
      SELECT pnl_usd FROM mock_trades
      WHERE status = 'CLOSED'
      ORDER BY created_at ASC
    `).all();

    let maxDrawdown = 0;
    let peak = 0;
    let running = 0;
    for (const t of allClosed) {
      running += t.pnl_usd;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return res.status(200).json({
      ok: true,
      account: {
        balance: account?.balance_usd || 0,
        peak: account?.peak_balance_usd || 0,
        startBalance: 1_000_000,
        totalReturn: ((account?.balance_usd || 1_000_000) - 1_000_000),
        totalReturnPct: (((account?.balance_usd || 1_000_000) - 1_000_000) / 1_000_000) * 100,
      },
      summary: {
        totalTrades: totals?.totalTrades || 0,
        wins: totals?.totalWins || 0,
        losses: totals?.totalLosses || 0,
        winRate: totals?.totalTrades > 0 ? totals.totalWins / totals.totalTrades : 0,
        totalPnl: totals?.totalPnl || 0,
        avgReturn: totals?.avgReturn || 0,
        bestTrade: totals?.bestTrade || 0,
        worstTrade: totals?.worstTrade || 0,
        maxDrawdown,
        openTradeCount: openTrades.length,
      },
      openTrades: openTrades.map(t => ({
        id: t.id,
        createdAt: t.created_at,
        symbol: t.symbol,
        strategy: t.strategy_name,
        side: t.side,
        entryPrice: t.entry_price,
        sizeUsd: t.size_usd,
        leverage: t.leverage,
        takeProfitPct: t.take_profit_pct,
        stopLossPct: t.stop_loss_pct,
      })),
      closedTrades: closedTrades.map(t => ({
        id: t.id,
        createdAt: t.created_at,
        symbol: t.symbol,
        strategy: t.strategy_name,
        side: t.side,
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        sizeUsd: t.size_usd,
        leverage: t.leverage,
        pnlUsd: t.pnl_usd,
        pnlPct: t.pnl_pct,
      })),
      strategyStats: strategyStats.map(s => ({
        strategy: s.strategy_name,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        winRate: s.trades > 0 ? s.wins / s.trades : 0,
        totalPnl: s.total_pnl,
        avgReturn: s.avg_return,
        bestTrade: s.best_trade,
        worstTrade: s.worst_trade,
      })),
      dailyPnl: dailyPnl.map(d => ({
        day: d.day,
        trades: d.trades,
        wins: d.wins,
        pnl: d.pnl,
      })),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[mock-trading-dashboard] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
