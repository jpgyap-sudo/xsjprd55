// ============================================================
// API: Perpetual Signal Trader Dashboard
// Returns account stats, open/closed trades, strategy perf,
// trade logs, and signal memory for the UI.
// ============================================================

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { detail } = req.query;

  try {
    // Account
    const { data: account, error: accErr } = await supabase
      .from('perpetual_mock_accounts')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (accErr) console.error('[perpetual-trader] account error:', accErr.message);

    // Open trades with current prices
    const { data: openTrades, error: openErr } = await supabase
      .from('perpetual_mock_trades')
      .select('id, created_at, symbol, side, entry_price, position_size_usd, margin_used, leverage, stop_loss, take_profit, risk_reward, strategy, confidence, timeframe, entry_reason')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50);

    if (openErr) console.error('[perpetual-trader] open trades error:', openErr.message);

    // Closed trades
    const { data: closedTrades, error: closedErr } = await supabase
      .from('perpetual_mock_trades')
      .select('id, created_at, symbol, side, entry_price, exit_price, position_size_usd, leverage, pnl_usd, pnl_pct, exit_reason, exit_at, strategy, confidence, entry_reason, exit_reason_detail')
      .eq('status', 'closed')
      .order('exit_at', { ascending: false })
      .limit(50);

    if (closedErr) console.error('[perpetual-trader] closed trades error:', closedErr.message);

    // Strategy performance
    const { data: stratPerf, error: stratErr } = await supabase
      .from('perpetual_mock_trades')
      .select('strategy, pnl_usd, side, status');

    const strategyMap = new Map();
    for (const t of stratPerf || []) {
      const s = strategyMap.get(t.strategy) || { trades: 0, wins: 0, losses: 0, totalPnl: 0, longs: 0, shorts: 0 };
      if (t.status === 'closed') {
        s.trades++;
        if (t.pnl_usd > 0) s.wins++; else s.losses++;
        s.totalPnl += t.pnl_usd;
        if (t.side === 'LONG') s.longs++; else s.shorts++;
      }
      strategyMap.set(t.strategy, s);
    }
    const strategyStats = Array.from(strategyMap.entries()).map(([name, s]) => ({
      name,
      trades: s.trades,
      wins: s.wins,
      losses: s.losses,
      winRate: s.trades > 0 ? s.wins / s.trades : 0,
      totalPnl: s.totalPnl,
      avgPnl: s.trades > 0 ? s.totalPnl / s.trades : 0,
      longs: s.longs,
      shorts: s.shorts,
    })).sort((a, b) => b.totalPnl - a.totalPnl);

    // Pair performance
    const { data: pairPerf } = await supabase
      .from('perpetual_mock_trades')
      .select('symbol, pnl_usd, status')
      .eq('status', 'closed');
    const pairMap = new Map();
    for (const t of pairPerf || []) {
      const p = pairMap.get(t.symbol) || { trades: 0, wins: 0, totalPnl: 0 };
      p.trades++;
      if (t.pnl_usd > 0) p.wins++;
      p.totalPnl += t.pnl_usd;
      pairMap.set(t.symbol, p);
    }
    const pairStats = Array.from(pairMap.entries()).map(([symbol, p]) => ({
      symbol, trades: p.trades, wins: p.wins,
      winRate: p.trades > 0 ? p.wins / p.trades : 0,
      totalPnl: p.totalPnl,
    })).sort((a, b) => b.totalPnl - a.totalPnl);

    // Recent logs
    const { data: logs, error: logErr } = await supabase
      .from('perpetual_trader_logs')
      .select('level, category, message, details, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (logErr) console.error('[perpetual-trader] logs error:', logErr.message);

    // Signal memory recent
    const { data: memory, error: memErr } = await supabase
      .from('signal_memory')
      .select('symbol, side, strategy, confidence, outcome, outcome_pnl, description, generated_at')
      .order('generated_at', { ascending: false })
      .limit(20);

    if (memErr) console.error('[perpetual-trader] memory error:', memErr.message);

    const closed = closedTrades || [];
    const totalTrades = closed.length;
    const totalWins = closed.filter(t => (t.pnl_usd || 0) > 0).length;
    const totalPnl = closed.reduce((s, t) => s + (t.pnl_usd || 0), 0);
    const bestTrade = closed.length ? Math.max(...closed.map(t => t.pnl_usd || 0)) : 0;
    const worstTrade = closed.length ? Math.min(...closed.map(t => t.pnl_usd || 0)) : 0;

    // Max drawdown
    let maxDrawdown = 0, peak = 0, running = 0;
    for (const t of closed.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      running += t.pnl_usd || 0;
      if (running > peak) peak = running;
      maxDrawdown = Math.max(maxDrawdown, peak - running);
    }

    const startBalance = account?.starting_balance || 100000;
    const currentBalance = account?.current_balance || startBalance;
    const equity = account?.equity || currentBalance;

    return res.status(200).json({
      ok: true,
      account: {
        name: account?.name || 'Perpetual Signal Trader',
        startBalance,
        currentBalance,
        availableBalance: account?.available_balance || currentBalance,
        equity,
        marginUsed: account?.margin_used || 0,
        unrealizedPnl: account?.unrealized_pnl || 0,
        realizedPnl: account?.realized_pnl || 0,
        peakBalance: account?.peak_balance || startBalance,
        totalReturn: currentBalance - startBalance,
        totalReturnPct: startBalance > 0 ? ((currentBalance - startBalance) / startBalance) * 100 : 0,
        tradingEnabled: account?.trading_enabled ?? true,
        tradingPausedReason: account?.trading_paused_reason || null,
        dailyPnlToday: account?.daily_pnl_today || 0,
        tradesToday: account?.trades_today || 0,
        minConfidence: (account?.min_confidence_threshold || 0.55) * 100,
        maxLeverage: account?.max_leverage || 10,
        maxRiskPerTrade: (account?.max_risk_per_trade || 0.01) * 100,
      },
      summary: {
        totalTrades,
        wins: totalWins,
        losses: totalTrades - totalWins,
        winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
        totalPnl,
        avgPnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
        bestTrade,
        worstTrade,
        maxDrawdown,
        openTradeCount: (openTrades || []).length,
      },
      openTrades: (openTrades || []).map(t => ({
        id: t.id, createdAt: t.created_at, symbol: t.symbol, side: t.side,
        entryPrice: t.entry_price, sizeUsd: t.position_size_usd,
        marginUsed: t.margin_used, leverage: t.leverage,
        stopLoss: t.stop_loss, takeProfit: t.take_profit,
        riskReward: t.risk_reward, strategy: t.strategy,
        confidence: t.confidence, timeframe: t.timeframe,
        entryReason: t.entry_reason,
      })),
      closedTrades: closed.map(t => ({
        id: t.id, createdAt: t.created_at, symbol: t.symbol, side: t.side,
        entryPrice: t.entry_price, exitPrice: t.exit_price,
        sizeUsd: t.position_size_usd, leverage: t.leverage,
        pnlUsd: t.pnl_usd, pnlPct: t.pnl_pct,
        exitReason: t.exit_reason, exitAt: t.exit_at,
        strategy: t.strategy, confidence: t.confidence,
        entryReason: t.entry_reason, exitReasonDetail: t.exit_reason_detail,
      })),
      strategyStats,
      pairStats,
      logs: (logs || []).map(l => ({
        level: l.level, category: l.category,
        message: l.message, details: l.details,
        createdAt: l.created_at,
      })),
      signalMemory: (memory || []).map(m => ({
        symbol: m.symbol, side: m.side, strategy: m.strategy,
        confidence: m.confidence, outcome: m.outcome,
        outcomePnl: m.outcome_pnl, description: m.description,
        generatedAt: m.generated_at,
      })),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[perpetual-trader] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
