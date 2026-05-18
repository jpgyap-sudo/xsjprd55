// ============================================================
// API: Perpetual Trader — Complete Trade History
// GET /api/perpetual-trader/trade-history
// Returns paginated trade history with analysis for the dashboard.
// Supports filtering by symbol, strategy, side.
// ============================================================

import { supabase, isSupabaseNoOp } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

function buildAnalytics(trades = []) {
  const totalPnl = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const wins = trades.filter((t) => (t.pnl_usd || 0) > 0).length;
  const grossProfit = trades.filter((t) => (t.pnl_usd || 0) > 0).reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const grossLoss = Math.abs(trades.filter((t) => (t.pnl_usd || 0) < 0).reduce((s, t) => s + (t.pnl_usd || 0), 0));
  const sortedByPnl = trades.slice().sort((a, b) => (b.pnl_usd || 0) - (a.pnl_usd || 0));

  let maxDrawdown = 0;
  let peak = 0;
  let running = 0;
  for (const trade of trades.slice().sort((a, b) => (a.exit_at || '').localeCompare(b.exit_at || ''))) {
    running += trade.pnl_usd || 0;
    if (running > peak) peak = running;
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  const holdTimes = trades.filter((t) => t.hold_duration_minutes != null).map((t) => t.hold_duration_minutes);
  const confidences = trades.filter((t) => t.confidence != null).map((t) => t.confidence);
  const byStrategy = new Map();
  const bySymbol = new Map();

  for (const trade of trades) {
    const strategy = trade.strategy || 'unknown';
    const strategyRow = byStrategy.get(strategy) || { strategy, trades: 0, wins: 0, losses: 0, totalPnl: 0, bestPnl: Number.NEGATIVE_INFINITY, worstPnl: Number.POSITIVE_INFINITY };
    strategyRow.trades++;
    if ((trade.pnl_usd || 0) > 0) strategyRow.wins++; else strategyRow.losses++;
    strategyRow.totalPnl += trade.pnl_usd || 0;
    strategyRow.bestPnl = Math.max(strategyRow.bestPnl, trade.pnl_usd || 0);
    strategyRow.worstPnl = Math.min(strategyRow.worstPnl, trade.pnl_usd || 0);
    byStrategy.set(strategy, strategyRow);

    const symbol = trade.symbol || 'unknown';
    const symbolRow = bySymbol.get(symbol) || { symbol, trades: 0, wins: 0, losses: 0, totalPnl: 0, bestPnl: Number.NEGATIVE_INFINITY, worstPnl: Number.POSITIVE_INFINITY };
    symbolRow.trades++;
    if ((trade.pnl_usd || 0) > 0) symbolRow.wins++; else symbolRow.losses++;
    symbolRow.totalPnl += trade.pnl_usd || 0;
    symbolRow.bestPnl = Math.max(symbolRow.bestPnl, trade.pnl_usd || 0);
    symbolRow.worstPnl = Math.min(symbolRow.worstPnl, trade.pnl_usd || 0);
    bySymbol.set(symbol, symbolRow);
  }

  const strategyBreakdown = Array.from(byStrategy.values()).map((row) => ({
    ...row,
    winRate: row.trades > 0 ? row.wins / row.trades : 0,
    avgPnl: row.trades > 0 ? row.totalPnl / row.trades : 0,
    profitFactor: row.losses > 0
      ? row.totalPnl > 0
        ? grossProfit / grossLoss
        : 0
      : row.wins > 0
        ? Infinity
        : 0,
  })).sort((a, b) => b.totalPnl - a.totalPnl);

  const symbolBreakdown = Array.from(bySymbol.values()).map((row) => ({
    ...row,
    winRate: row.trades > 0 ? row.wins / row.trades : 0,
    avgPnl: row.trades > 0 ? row.totalPnl / row.trades : 0,
  })).sort((a, b) => b.totalPnl - a.totalPnl);

  return {
    summary: {
      totalTrades: trades.length,
      wins,
      losses: trades.length - wins,
      winRate: trades.length > 0 ? wins / trades.length : 0,
      totalPnl,
      avgPnl: trades.length > 0 ? totalPnl / trades.length : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdown,
      bestTrade: sortedByPnl[0]?.pnl_usd || 0,
      worstTrade: sortedByPnl[sortedByPnl.length - 1]?.pnl_usd || 0,
      avgHoldMinutes: holdTimes.length ? Math.round(holdTimes.reduce((s, v) => s + v, 0) / holdTimes.length) : 0,
      avgConfidence: confidences.length ? confidences.reduce((s, v) => s + v, 0) / confidences.length : 0,
    },
    strategyBreakdown,
    symbolBreakdown,
    allTrades: trades.map(mapTrade),
    whatWorked: trades.filter((t) => (t.pnl_usd || 0) > 0 && t.what_went_right).slice(0, 10).map(mapTrade),
    whatFailed: trades.filter((t) => (t.pnl_usd || 0) < 0 && t.what_went_wrong).slice(0, 10).map(mapTrade),
    bestTrades: sortedByPnl.slice(0, 10).map(mapTrade),
    worstTrades: sortedByPnl.slice(-10).reverse().map(mapTrade),
  };
}

function mapTrade(t) {
  return {
    id: t.id,
    tradeId: t.trade_id,
    symbol: t.symbol,
    side: t.side,
    strategy: t.strategy,
    timeframe: t.timeframe,
    entryPrice: t.entry_price,
    exitPrice: t.exit_price,
    entryAt: t.entry_at,
    exitAt: t.exit_at,
    pnlUsd: t.pnl_usd,
    pnlPct: t.pnl_pct,
    leverage: t.leverage,
    positionSizeUsd: t.position_size_usd,
    marginUsed: t.margin_used,
    exitReason: t.exit_reason,
    exitQuality: t.exit_quality,
    holdDurationMinutes: t.hold_duration_minutes,
    confidence: t.confidence,
    whatWentRight: t.what_went_right,
    whatWentWrong: t.what_went_wrong,
    strategyNotes: t.strategy_notes,
    marketCondition: t.market_condition,
    riskReward: t.risk_reward,
    stopLoss: t.stop_loss,
    takeProfit: t.take_profit,
  };
}

function isMissingRelationError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205' || String(error?.message || '').includes('Could not find the table');
}

function mapRawTradeToHistoryShape(t) {
  return {
    id: t.id,
    trade_id: t.id,
    symbol: t.symbol,
    side: t.side,
    strategy: t.strategy,
    timeframe: t.timeframe,
    entry_price: t.entry_price,
    exit_price: t.exit_price,
    entry_at: t.created_at,
    exit_at: t.exit_at,
    pnl_usd: t.pnl_usd,
    pnl_pct: t.pnl_pct,
    leverage: t.leverage,
    position_size_usd: t.position_size_usd,
    margin_used: t.margin_used,
    exit_reason: t.exit_reason,
    exit_quality: null,
    hold_duration_minutes: t.exit_at && t.created_at
      ? Math.round((new Date(t.exit_at).getTime() - new Date(t.created_at).getTime()) / 60000)
      : null,
    confidence: t.confidence,
    what_went_right: null,
    what_went_wrong: null,
    strategy_notes: null,
    market_condition: null,
    risk_reward: t.risk_reward,
    stop_loss: t.stop_loss,
    take_profit: t.take_profit,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (isSupabaseNoOp()) {
      return res.status(503).json({
        ok: false,
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      });
    }

    const {
      limit = '100',
      offset = '0',
      symbol,
      strategy,
      side,
      sortBy = 'exit_at',
      sortDir = 'desc',
    } = req.query;

    const limitNum = Math.min(parseInt(limit, 10) || 100, 500);
    const offsetNum = parseInt(offset, 10) || 0;

    // Build filtered base query for page rows
    let q = supabase
      .from('perp_trade_history')
      .select('*', { count: 'exact' })
      .not('exit_at', 'is', null); // Only closed trades

    let analyticsQuery = supabase
      .from('perp_trade_history')
      .select('*')
      .not('exit_at', 'is', null);

    if (symbol) {
      q = q.eq('symbol', symbol.toUpperCase());
      analyticsQuery = analyticsQuery.eq('symbol', symbol.toUpperCase());
    }
    if (strategy) {
      q = q.ilike('strategy', `%${strategy}%`);
      analyticsQuery = analyticsQuery.ilike('strategy', `%${strategy}%`);
    }
    if (side) {
      q = q.eq('side', side.toUpperCase());
      analyticsQuery = analyticsQuery.eq('side', side.toUpperCase());
    }

    // Validate sort column to prevent injection
    const allowedSorts = ['exit_at', 'entry_at', 'pnl_usd', 'pnl_pct', 'created_at', 'hold_duration_minutes', 'confidence'];
    const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'exit_at';
    const safeDir = sortDir === 'asc' ? 'asc' : 'desc';

    q = q.order(safeSort, { ascending: safeDir === 'asc' });
    q = q.range(offsetNum, offsetNum + limitNum - 1);

    let [{ data, error, count }, { data: analyticsRows, error: analyticsErr }] = await Promise.all([
      q,
      analyticsQuery,
    ]);

    let historySource = 'perp_trade_history';
    if (isMissingRelationError(error) || isMissingRelationError(analyticsErr)) {
      const buildRawQuery = () => {
        let rawQuery = supabase
          .from('perpetual_mock_trades')
          .select('*', { count: 'exact' })
          .eq('status', 'closed');
        if (symbol) rawQuery = rawQuery.eq('symbol', symbol.toUpperCase());
        if (strategy) rawQuery = rawQuery.ilike('strategy', `%${strategy}%`);
        if (side) rawQuery = rawQuery.eq('side', side.toUpperCase());
        return rawQuery;
      };

      const rawAllQuery = buildRawQuery();
      const rawSortMap = {
        entry_at: 'created_at',
        hold_duration_minutes: 'exit_at',
      };
      const rawPageQuery = buildRawQuery()
        .order(rawSortMap[safeSort] || safeSort, { ascending: safeDir === 'asc' })
        .range(offsetNum, offsetNum + limitNum - 1);

      const [rawPage, rawAll] = await Promise.all([rawPageQuery, rawAllQuery]);
      if (rawPage.error) throw rawPage.error;
      if (rawAll.error) throw rawAll.error;
      data = (rawPage.data || []).map(mapRawTradeToHistoryShape);
      analyticsRows = (rawAll.data || []).map(mapRawTradeToHistoryShape);
      count = rawPage.count || analyticsRows.length;
      historySource = 'perpetual_mock_trades_fallback';
      error = null;
      analyticsErr = null;
    }

    if (error) throw error;
    if (analyticsErr) throw analyticsErr;

    const trades = data || [];
    const analytics = buildAnalytics(analyticsRows || []);

    return res.status(200).json({
      ok: true,
      summary: analytics.summary,
      analytics,
      historySource,
      trades: trades.map(mapTrade),
      pagination: {
        total: count || trades.length,
        limit: limitNum,
        offset: offsetNum,
        hasMore: (offsetNum + limitNum) < (count || trades.length),
      },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[perp-trade-history] Error: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
