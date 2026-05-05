// ============================================================
// Mock Trading Dashboard API (Supabase version)
// Returns paper account stats, open/closed trades, PnL analysis,
// and strategy performance for the mock trading tab.
// NOTE: Reads from Supabase (where mock-trading-worker writes).
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

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

    const requestedAccountId = req.query?.accountId || null;

    // Account stats
    const { data: accounts, error: accountErr } = await supabase
      .from('mock_accounts')
      .select('*')
      .order('created_at', { ascending: true });

    if (accountErr) {
      console.error('[mock-trading-dashboard] account error:', accountErr.message);
      diagnostics.errors.push({ scope: 'mock_accounts', message: accountErr.message, code: accountErr.code });
    }

    // Use the account that has the most trades, unless the caller requests one.
    // This keeps the account card and the trade tables on the same paper wallet.
    const { data: accountTradeStats, error: accountTradeErr } = await supabase
      .from('mock_trades')
      .select('account_id, status, pnl_usd, closed_at, created_at')
      .limit(5000);
    if (accountTradeErr) {
      diagnostics.errors.push({ scope: 'account_trade_stats', message: accountTradeErr.message, code: accountTradeErr.code });
    }

    const tradeCountByAccount = new Map();
    for (const trade of accountTradeStats || []) {
      if (!trade.account_id) continue;
      tradeCountByAccount.set(trade.account_id, (tradeCountByAccount.get(trade.account_id) || 0) + 1);
    }

    const accountList = accounts || [];
    let account = requestedAccountId
      ? accountList.find(a => String(a.id) === String(requestedAccountId))
      : null;
    if (!account) {
      account = accountList
        .slice()
        .sort((a, b) => {
          const countDiff = (tradeCountByAccount.get(b.id) || 0) - (tradeCountByAccount.get(a.id) || 0);
          if (countDiff !== 0) return countDiff;
          if (a.name === 'Execution Optimizer v3') return -1;
          if (b.name === 'Execution Optimizer v3') return 1;
          return String(a.name || '').localeCompare(String(b.name || ''));
        })[0] || null;
    }
    const selectedAccountId = account?.id || null;

    // Open trades
    let openQuery = supabase
      .from('mock_trades')
      .select('id, account_id, created_at, symbol, strategy_name, side, entry_price, position_size_usd, margin_used, leverage, take_profit, stop_loss, status, entry_reason')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50);
    if (selectedAccountId) openQuery = openQuery.eq('account_id', selectedAccountId);
    const { data: openTrades, error: openErr } = await openQuery;

    if (openErr) {
      console.error('[mock-trading-dashboard] open trades error:', openErr.message);
      diagnostics.errors.push({ scope: 'open_mock_trades', message: openErr.message, code: openErr.code });
    }

    // Recent closed trades
    let closedDisplayQuery = supabase
      .from('mock_trades')
      .select('id, account_id, created_at, symbol, strategy_name, side, entry_price, exit_price, position_size_usd, margin_used, leverage, pnl_usd, pnl_pct, status, exit_reason, closed_at')
      .eq('status', 'closed')
      .order('closed_at', { ascending: false, nullsFirst: false })
      .limit(50);
    if (selectedAccountId) closedDisplayQuery = closedDisplayQuery.eq('account_id', selectedAccountId);
    const { data: closedTrades, error: closedErr } = await closedDisplayQuery;

    if (closedErr) {
      console.error('[mock-trading-dashboard] closed trades error:', closedErr.message);
      diagnostics.errors.push({ scope: 'closed_mock_trades', message: closedErr.message, code: closedErr.code });
    }

    // Per-strategy performance
    let statsQuery = supabase
      .from('mock_trades')
      .select('id, account_id, created_at, closed_at, strategy_name, pnl_usd')
      .eq('status', 'closed')
      .limit(5000);
    if (selectedAccountId) statsQuery = statsQuery.eq('account_id', selectedAccountId);
    const { data: strategyStats, error: statsErr } = await statsQuery;

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
        avgReturn: s.trades > 0 ? s.totalPnl / s.trades : 0,
        bestTrade: s.best === -Infinity ? 0 : s.best,
        worstTrade: s.worst === Infinity ? 0 : s.worst,
      }))
      .sort((a, b) => b.totalPnl - a.totalPnl);

    // Daily PnL (last 30 days) — grouped by closed_at, not created_at
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let dailyQuery = supabase
      .from('mock_trades')
      .select('closed_at, pnl_usd')
      .eq('status', 'closed')
      .gte('closed_at', thirtyDaysAgo);
    if (selectedAccountId) dailyQuery = dailyQuery.eq('account_id', selectedAccountId);
    const { data: dailyRaw, error: dailyErr } = await dailyQuery;

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
    const closed = strategyStats || [];
    const displayClosed = closedTrades || [];
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
    for (const t of closed.slice().sort((a, b) => (a.closed_at || a.created_at || '').localeCompare(b.closed_at || b.created_at || ''))) {
      running += t.pnl_usd || 0;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const startBalance = account?.starting_balance || 10000;
    const derivedBalance = startBalance + totalPnl;
    const storedBalance = account?.current_balance ?? null;
    const currentBalance = derivedBalance;
    const storedBalanceDrift = storedBalance == null ? 0 : Number(storedBalance) - derivedBalance;
    const peakBalance = Math.max(
      derivedBalance,
      Number(account?.peak_balance || startBalance),
      startBalance + Math.max(0, peak)
    );
    diagnostics.account = {
      selectedAccountId,
      selectedAccountName: account?.name || null,
      storedBalance,
      derivedBalance,
      storedBalanceDrift,
      balanceSource: Math.abs(storedBalanceDrift) > 0.01 ? 'derived_from_closed_pnl' : 'stored_account'
    };

    const responseBody = {
      ok: true,
      account: {
        id: selectedAccountId,
        name: account?.name || 'Mock Account',
        balance: currentBalance,
        storedBalance,
        derivedBalance,
        balanceSource: diagnostics.account.balanceSource,
        peak: peakBalance,
        startBalance,
        totalReturn: currentBalance - startBalance,
        totalReturnPct: startBalance > 0 ? ((currentBalance - startBalance) / startBalance) * 100 : 0,
        realizedPnl: totalPnl,
      },
      accounts: accountList.map(a => ({
        id: a.id,
        name: a.name,
        balance: a.current_balance,
        startingBalance: a.starting_balance,
        tradeCount: tradeCountByAccount.get(a.id) || 0
      })),
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
        accountId: t.account_id,
        createdAt: t.created_at,
        openedAt: t.created_at,
        symbol: t.symbol,
        strategy: t.strategy_name,
        side: t.side,
        entryPrice: t.entry_price,
        sizeUsd: t.position_size_usd,
        marginUsed: t.margin_used,
        leverage: t.leverage,
        takeProfit: t.take_profit,
        stopLoss: t.stop_loss,
        entryReason: t.entry_reason,
        ageMinutes: t.created_at ? Math.max(0, Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000)) : null,
      })),
      closedTrades: displayClosed.map(t => ({
        id: t.id,
        accountId: t.account_id,
        createdAt: t.created_at,
        openedAt: t.created_at,
        closedAt: t.closed_at,
        symbol: t.symbol,
        strategy: t.strategy_name,
        side: t.side,
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        sizeUsd: t.position_size_usd,
        marginUsed: t.margin_used,
        leverage: t.leverage,
        pnlUsd: t.pnl_usd,
        pnlPct: t.pnl_pct,
        exitReason: t.exit_reason,
        holdMinutes: t.closed_at && t.created_at
          ? Math.max(0, Math.round((new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()) / 60000))
          : null,
      })),
      strategyStats: strategyStatsList,
      dailyPnl,
      diagnostics,
      ts: new Date().toISOString(),
    };

    // Trade history (last 100 open/close events)
    try {
      const { data: history } = await supabase
        .from('mock_trade_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      responseBody.tradeHistory = (history || []).map(h => ({
        id: h.id,
        tradeId: h.trade_id,
        event: h.event,
        symbol: h.symbol,
        side: h.side,
        price: h.price,
        pnlUsd: h.pnl_usd,
        pnlPct: h.pnl_pct,
        balanceAfter: h.balance_after,
        leverage: h.leverage,
        positionSizeUsd: h.position_size_usd,
        exitReason: h.exit_reason,
        createdAt: h.created_at,
      }));
    } catch (histErr) {
      logger.debug('[mock-trading-dashboard] trade history skipped:', histErr.message);
      responseBody.tradeHistory = [];
    }

    return res.status(200).json(responseBody);
  } catch (err) {
    console.error('[mock-trading-dashboard] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
