// ============================================================
// Mock Trading Dashboard API (Supabase version)
// Returns paper account stats, open/closed trades, PnL analysis,
// and strategy performance for the mock trading tab.
// NOTE: Reads from Supabase (where mock-trading-worker writes).
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const diagnostics = {
      supabaseNoOp: isSupabaseNoOp(),
      errors: [],
      schema: {},
      signals: {},
    };

    // Account stats
    const { data: account, error: accountErr } = await supabase
      .from('mock_accounts')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (accountErr) {
      console.error('[mock-trading-dashboard] account error:', accountErr.message);
      diagnostics.errors.push({ scope: 'mock_accounts', message: accountErr.message, code: accountErr.code });
    }

    // Open trades
    const { data: openTrades, error: openErr } = await supabase
      .from('mock_trades')
      .select('id, created_at, symbol, strategy_name, side, entry_price, position_size_usd, leverage, take_profit, stop_loss, status, entry_reason')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50);

    if (openErr) {
      console.error('[mock-trading-dashboard] open trades error:', openErr.message);
      diagnostics.errors.push({ scope: 'open_mock_trades', message: openErr.message, code: openErr.code });
    }

    // Recent closed trades
    const { data: closedTrades, error: closedErr } = await supabase
      .from('mock_trades')
      .select('id, created_at, symbol, strategy_name, side, entry_price, exit_price, position_size_usd, leverage, pnl_usd, pnl_pct, status, exit_reason, closed_at')
      .eq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(50);

    if (closedErr) {
      console.error('[mock-trading-dashboard] closed trades error:', closedErr.message);
      diagnostics.errors.push({ scope: 'closed_mock_trades', message: closedErr.message, code: closedErr.code });
    }

    // Per-strategy performance
    const { data: strategyStats, error: statsErr } = await supabase
      .from('mock_trades')
      .select('strategy_name, pnl_usd')
      .eq('status', 'closed');

    if (statsErr) {
      console.error('[mock-trading-dashboard] stats error:', statsErr.message);
      diagnostics.errors.push({ scope: 'strategy_stats', message: statsErr.message, code: statsErr.code });
    }

    // Schema smoke check for columns used by the v3 execution/aggressive engines.
    const { error: metadataErr } = await supabase
      .from('mock_trades')
      .select('id, metadata')
      .limit(1);
    diagnostics.schema.mockTradesMetadata = !metadataErr;
    if (metadataErr) {
      diagnostics.errors.push({ scope: 'schema.mock_trades.metadata', message: metadataErr.message, code: metadataErr.code });
    }

    // Signal freshness tells us if workers have anything to trade.
    const { data: latestSignals, error: signalsErr } = await supabase
      .from('signals')
      .select('id, symbol, side, confidence, generated_at, valid_until, status')
      .eq('status', 'active')
      .order('generated_at', { ascending: false })
      .limit(10);
    if (signalsErr) {
      diagnostics.errors.push({ scope: 'signals', message: signalsErr.message, code: signalsErr.code });
    }
    const latestSignalAt = latestSignals?.[0]?.generated_at || null;
    diagnostics.signals = {
      activeSampleCount: latestSignals?.length || 0,
      latestSignalAt,
      latestSignalAgeMinutes: latestSignalAt
        ? Math.round((Date.now() - new Date(latestSignalAt).getTime()) / 60000)
        : null,
      sample: (latestSignals || []).slice(0, 5),
    };

    // Compute strategy aggregates in JS
    const strategyMap = new Map();
    for (const t of strategyStats || []) {
      const s = strategyMap.get(t.strategy_name) || { trades: 0, wins: 0, losses: 0, totalPnl: 0, best: -Infinity, worst: Infinity };
      s.trades++;
      if (t.pnl_usd > 0) s.wins++;
      else s.losses++;
      s.totalPnl += t.pnl_usd;
      if (t.pnl_usd > s.best) s.best = t.pnl_usd;
      if (t.pnl_usd < s.worst) s.worst = t.pnl_usd;
      strategyMap.set(t.strategy_name, s);
    }
    const strategyStatsList = Array.from(strategyMap.entries())
      .map(([strategy, s]) => ({
        strategy,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        winRate: s.trades > 0 ? s.wins / s.trades : 0,
        totalPnl: s.totalPnl,
        bestTrade: s.best === -Infinity ? 0 : s.best,
        worstTrade: s.worst === Infinity ? 0 : s.worst,
      }))
      .sort((a, b) => b.totalPnl - a.totalPnl);

    // Daily PnL (last 30 days) — grouped by closed_at, not created_at
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dailyRaw, error: dailyErr } = await supabase
      .from('mock_trades')
      .select('closed_at, pnl_usd')
      .eq('status', 'closed')
      .gte('closed_at', thirtyDaysAgo);

    if (dailyErr) {
      console.error('[mock-trading-dashboard] daily error:', dailyErr.message);
      diagnostics.errors.push({ scope: 'daily_pnl', message: dailyErr.message, code: dailyErr.code });
    }

    const dayMap = new Map();
    for (const t of dailyRaw || []) {
      const day = (t.closed_at || '').slice(0, 10);
      if (!day) continue;
      const d = dayMap.get(day) || { trades: 0, wins: 0, pnl: 0 };
      d.trades++;
      if (t.pnl_usd > 0) d.wins++;
      d.pnl += t.pnl_usd;
      dayMap.set(day, d);
    }
    const dailyPnl = Array.from(dayMap.entries())
      .map(([day, d]) => ({ day, trades: d.trades, wins: d.wins, pnl: d.pnl }))
      .sort((a, b) => b.day.localeCompare(a.day));

    // Totals
    const closed = closedTrades || [];
    const totalTrades = closed.length;
    const totalWins = closed.filter(t => (t.pnl_usd || 0) > 0).length;
    const totalLosses = totalTrades - totalWins;
    const totalPnl = closed.reduce((s, t) => s + (t.pnl_usd || 0), 0);
    const avgReturn = totalTrades > 0 ? totalPnl / totalTrades : 0;
    const bestTrade = closed.length ? Math.max(...closed.map(t => t.pnl_usd || 0)) : 0;
    const worstTrade = closed.length ? Math.min(...closed.map(t => t.pnl_usd || 0)) : 0;

    // Max drawdown
    let maxDrawdown = 0;
    let peak = 0;
    let running = 0;
    for (const t of closed.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      running += t.pnl_usd || 0;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const startBalance = account?.starting_balance || 10000;
    const currentBalance = account?.current_balance || startBalance;

    return res.status(200).json({
      ok: true,
      account: {
        balance: currentBalance,
        peak: Math.max(currentBalance, account?.peak_balance || currentBalance),
        startBalance,
        totalReturn: currentBalance - startBalance,
        totalReturnPct: startBalance > 0 ? ((currentBalance - startBalance) / startBalance) * 100 : 0,
      },
      summary: {
        totalTrades,
        wins: totalWins,
        losses: totalLosses,
        winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
        totalPnl,
        avgReturn,
        bestTrade,
        worstTrade,
        maxDrawdown,
        openTradeCount: (openTrades || []).length,
      },
      openTrades: (openTrades || []).map(t => ({
        id: t.id,
        createdAt: t.created_at,
        symbol: t.symbol,
        strategy: t.strategy_name,
        side: t.side,
        entryPrice: t.entry_price,
        sizeUsd: t.position_size_usd,
        leverage: t.leverage,
        takeProfit: t.take_profit,
        stopLoss: t.stop_loss,
      })),
      closedTrades: closed.map(t => ({
        id: t.id,
        createdAt: t.created_at,
        symbol: t.symbol,
        strategy: t.strategy_name,
        side: t.side,
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        sizeUsd: t.position_size_usd,
        leverage: t.leverage,
        pnlUsd: t.pnl_usd,
        pnlPct: t.pnl_pct,
      })),
      strategyStats: strategyStatsList,
      dailyPnl,
      diagnostics,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[mock-trading-dashboard] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
