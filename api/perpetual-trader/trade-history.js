// ============================================================
// API: Perpetual Trader — Complete Trade History
// GET /api/perpetual-trader/trade-history
// Returns paginated trade history with analysis for the dashboard.
// Supports filtering by symbol, strategy, side.
// ============================================================

import { supabase, isSupabaseNoOp } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

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

    // Build query
    let q = supabase
      .from('perp_trade_history')
      .select('*', { count: 'exact' })
      .not('exit_at', 'is', null); // Only closed trades

    if (symbol) q = q.eq('symbol', symbol.toUpperCase());
    if (strategy) q = q.ilike('strategy', `%${strategy}%`);
    if (side) q = q.eq('side', side.toUpperCase());

    // Validate sort column to prevent injection
    const allowedSorts = ['exit_at', 'entry_at', 'pnl_usd', 'pnl_pct', 'created_at', 'hold_duration_minutes', 'confidence'];
    const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'exit_at';
    const safeDir = sortDir === 'asc' ? 'asc' : 'desc';

    q = q.order(safeSort, { ascending: safeDir === 'asc' });
    q = q.range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await q;

    if (error) throw error;

    // Compute summary stats from the returned data
    const trades = data || [];
    const totalPnl = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
    const wins = trades.filter(t => (t.pnl_usd || 0) > 0).length;
    const losses = trades.length - wins;

    return res.status(200).json({
      ok: true,
      summary: {
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? wins / trades.length : 0,
        totalPnl,
        avgPnl: trades.length > 0 ? totalPnl / trades.length : 0,
      },
      trades: trades.map(t => ({
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
      })),
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
