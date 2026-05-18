// ============================================================
// API: Perpetual Signal Trader Dashboard
// Returns account stats, open/closed trades, strategy perf,
// trade logs, signal memory, and TLL insights for the UI.
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { getPerpetualTraderDiagnostics } from '../lib/perpetual-trader/diagnostics.js';
import { getAllScorecards } from '../lib/mock-trading/strategy-scorecard.js';
import { fetchPublicPrice } from '../lib/market-price.js';
import { calculatePerpPnl, checkExit } from '../lib/perpetual-trader/risk.js';

function addApiError(errors, scope, error) {
  if (!error) return;
  errors.push({
    scope,
    code: error.code || null,
    message: error.message || String(error),
    details: error.details || null,
    hint: error.hint || null,
  });
}

function summarizeClosedTrades(trades = []) {
  const totalTrades = trades.length;
  const totalWins = trades.filter((t) => (t.pnl_usd || 0) > 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl_usd || 0), 0);
  const bestTrade = trades.length ? Math.max(...trades.map((t) => t.pnl_usd || 0)) : 0;
  const worstTrade = trades.length ? Math.min(...trades.map((t) => t.pnl_usd || 0)) : 0;

  let maxDrawdown = 0;
  let peak = 0;
  let running = 0;
  for (const t of trades.slice().sort((a, b) => (a.exit_at || a.created_at).localeCompare(b.exit_at || b.created_at))) {
    running += t.pnl_usd || 0;
    if (running > peak) peak = running;
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  return {
    totalTrades,
    wins: totalWins,
    losses: totalTrades - totalWins,
    winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
    totalPnl,
    avgPnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
    bestTrade,
    worstTrade,
    maxDrawdown,
  };
}

async function enrichOpenTrades(openTrades = []) {
  return Promise.all(openTrades.map(async (trade) => {
    try {
      const mark = await fetchPublicPrice(trade.symbol);
      const pnl = calculatePerpPnl({
        side: trade.side,
        entryPrice: trade.entry_price,
        exitPrice: mark.price,
        sizeUsd: trade.position_size_usd,
        leverage: trade.leverage,
      });
      const exit = checkExit({
        side: trade.side,
        entryPrice: trade.entry_price,
        currentPrice: mark.price,
        stopLoss: trade.stop_loss,
        takeProfit: trade.take_profit,
      });
      return {
        ...trade,
        mark_price: mark.price,
        mark_source: mark.source,
        unrealized_pnl_usd: pnl.pnlUsd,
        unrealized_pnl_pct: pnl.pnlPct,
        breached_exit: exit.shouldExit ? exit.reason : null,
        mark_error: null,
      };
    } catch (error) {
      return {
        ...trade,
        mark_price: null,
        mark_source: null,
        unrealized_pnl_usd: null,
        unrealized_pnl_pct: null,
        breached_exit: null,
        mark_error: error.message,
      };
    }
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const detail = req.query?.detail;
  const diagnostics = await getPerpetualTraderDiagnostics();

  if (detail === 'diagnostics') {
    return res.status(diagnostics.ok ? 200 : 503).json({
      ok: diagnostics.ok,
      diagnostics,
      ts: new Date().toISOString(),
    });
  }

  if (isSupabaseNoOp()) {
    return res.status(503).json({
      ok: false,
      error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      diagnostics,
      ts: new Date().toISOString(),
    });
  }

  if (diagnostics.status === 'blocked') {
    return res.status(503).json({
      ok: false,
      error: 'Perpetual trader is blocked by configuration or schema issues.',
      diagnostics,
      ts: new Date().toISOString(),
    });
  }

  try {
    const errors = [];

    // Account
    const { data: account, error: accErr } = await supabase
      .from('perpetual_mock_accounts')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (accErr) {
      console.error('[perpetual-trader] account error:', accErr.message);
      addApiError(errors, 'perpetual_mock_accounts', accErr);
    }

    // Open trades with current prices
    const { data: openTrades, error: openErr } = await supabase
      .from('perpetual_mock_trades')
      .select('id, created_at, symbol, side, entry_price, position_size_usd, margin_used, leverage, stop_loss, take_profit, risk_reward, strategy, confidence, timeframe, entry_reason')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50);

    if (openErr) {
      console.error('[perpetual-trader] open trades error:', openErr.message);
      addApiError(errors, 'open_perpetual_mock_trades', openErr);
    }

    // Closed trades
    const { data: closedTrades, error: closedErr } = await supabase
      .from('perpetual_mock_trades')
      .select('id, created_at, symbol, side, entry_price, exit_price, position_size_usd, leverage, pnl_usd, pnl_pct, exit_reason, exit_at, strategy, confidence, entry_reason, exit_reason_detail')
      .eq('status', 'closed')
      .order('exit_at', { ascending: false })
      .limit(50);

    if (closedErr) {
      console.error('[perpetual-trader] closed trades error:', closedErr.message);
      addApiError(errors, 'closed_perpetual_mock_trades', closedErr);
    }

    // Strategy performance
    const { data: allClosedTrades, error: allClosedErr } = await supabase
      .from('perpetual_mock_trades')
      .select('id, created_at, exit_at, symbol, side, pnl_usd, status, strategy')
      .eq('status', 'closed');

    if (allClosedErr) {
      console.error('[perpetual-trader] all closed trades error:', allClosedErr.message);
      addApiError(errors, 'all_closed_perpetual_mock_trades', allClosedErr);
    }

    const { data: stratPerf, error: stratErr } = await supabase
      .from('perpetual_mock_trades')
      .select('strategy, pnl_usd, side, status');

    if (stratErr) {
      console.error('[perpetual-trader] strategy stats error:', stratErr.message);
      addApiError(errors, 'strategy_stats', stratErr);
    }

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
    const pairPerf = allClosedTrades || [];
    const pairErr = allClosedErr;

    if (pairErr) {
      console.error('[perpetual-trader] pair stats error:', pairErr.message);
      addApiError(errors, 'pair_stats', pairErr);
    }
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

    if (logErr) {
      console.error('[perpetual-trader] logs error:', logErr.message);
      addApiError(errors, 'perpetual_trader_logs', logErr);
    }

    const { data: pipelineLogs, error: pipelineErr } = await supabase
      .from('perpetual_trader_logs')
      .select('message, details, created_at')
      .eq('category', 'signal_skip')
      .order('created_at', { ascending: false })
      .limit(20);

    if (pipelineErr) {
      console.error('[perpetual-trader] pipeline logs error:', pipelineErr.message);
      addApiError(errors, 'signal_pipeline_logs', pipelineErr);
    }

    // Signal memory recent
    const { data: memory, error: memErr } = await supabase
      .from('signal_memory')
      .select('signal_id, symbol, side, strategy, confidence, outcome, outcome_pnl, description, generated_at')
      .order('generated_at', { ascending: false })
      .limit(20);

    if (memErr) {
      console.error('[perpetual-trader] memory error:', memErr.message);
      addApiError(errors, 'signal_memory', memErr);
    }

    // ── TLL Insights ──────────────────────────────────────
    let tll = null;
    try {
      const { getTllMockTradingSnapshot } = await import('../lib/learning-layer/mock-trading-bridge.js');
      const tllSnapshot = await getTllMockTradingSnapshot();
      tll = {
        regime: tllSnapshot.regime,
        activeSkills: tllSnapshot.activeSkills,
        topSkills: tllSnapshot.topSkills,
        strategyWeights: tllSnapshot.strategyWeights,
        recentHealing: tllSnapshot.recentHealing,
        topPatterns: tllSnapshot.topPatterns,
      };
    } catch (tllErr) {
      console.error('[perpetual-trader] TLL snapshot error:', tllErr.message);
    }

    const enrichedOpenTrades = await enrichOpenTrades(openTrades || []);
    const closed = closedTrades || [];
    const scorecards = await getAllScorecards();
    const summary = summarizeClosedTrades(allClosedTrades || []);
    summary.openTradeCount = enrichedOpenTrades.length;

    const startBalance = account?.starting_balance || 100000;
    const currentBalance = account?.current_balance || startBalance;
    const equity = account?.equity || currentBalance;

    return res.status(200).json({
      ok: true,
      tll,
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
      diagnostics: {
        ...diagnostics,
        apiErrors: errors,
      },
      summary,
      freshness: {
        generatedAt: new Date().toISOString(),
        worker: diagnostics.trades?.worker || null,
      },
      openTrades: enrichedOpenTrades.map(t => ({
        id: t.id, createdAt: t.created_at, symbol: t.symbol, side: t.side,
        entryPrice: t.entry_price, sizeUsd: t.position_size_usd,
        marginUsed: t.margin_used, leverage: t.leverage,
        stopLoss: t.stop_loss, takeProfit: t.take_profit,
        riskReward: t.risk_reward, strategy: t.strategy,
        confidence: t.confidence, timeframe: t.timeframe,
        entryReason: t.entry_reason,
        markPrice: t.mark_price,
        markSource: t.mark_source,
        unrealizedPnlUsd: t.unrealized_pnl_usd,
        unrealizedPnlPct: t.unrealized_pnl_pct,
        breachedExit: t.breached_exit,
        markError: t.mark_error,
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
      scorecards,
      logs: (logs || []).map(l => ({
        level: l.level, category: l.category,
        message: l.message, details: l.details,
        createdAt: l.created_at,
      })),
      signalMemory: (memory || []).map(m => ({
        signalId: m.signal_id,
        symbol: m.symbol, side: m.side, strategy: m.strategy,
        confidence: m.confidence, outcome: m.outcome,
        outcomePnl: m.outcome_pnl, description: m.description,
        generatedAt: m.generated_at,
      })),
      signalPipeline: (pipelineLogs || []).map((log) => ({
        message: log.message,
        createdAt: log.created_at,
        ...(log.details || {}),
      })),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[perpetual-trader] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
