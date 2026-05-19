// ============================================================
// Perpetual Trader Bridge — Feeds perpetual trade outcomes
// into the Trading Learning Layer (TLL) for pattern discovery,
// skill generation, and strategy healing.
//
// Bridges: perpetual_mock_trades → brain_signal_memory
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { logBrainEvent } from '../brain/brain-telemetry.js';

const MAX_RESOLVE = parseInt(process.env.TLL_MAX_RESOLVE || '200', 10);

/**
 * Ingest recently closed perpetual trades into brain_signal_memory.
 * Dedup by signal_id (perpetual_mock_trades.id).
 * @param {number} [hours=24] — Look back window
 * @returns {Promise<{ingested: number, skipped: number, errors: string[]}>}
 */
export async function ingestPerpetualTradeOutcomes(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const errors = [];
  let ingested = 0;
  let skipped = 0;

  try {
    // Fetch closed perpetual trades within the window
    const { data: trades, error } = await supabase
      .from('perpetual_mock_trades')
      .select('id, symbol, side, entry_price, exit_price, pnl_usd, pnl_pct, strategy, timeframe, confidence, exit_reason, exit_at, market_regime_at_entry, r_multiple_at_close, entry_features, created_at')
      .eq('status', 'closed')
      .gte('exit_at', since)
      .order('exit_at', { ascending: false })
      .limit(MAX_RESOLVE);

    if (error) {
      logger.error('[PerpTLL] Fetch error:', error.message);
      return { ingested: 0, skipped: 0, errors: [error.message] };
    }

    if (!trades || trades.length === 0) {
      return { ingested: 0, skipped: 0, errors: [] };
    }

    // Check which trade IDs already exist in brain_signal_memory
    const tradeIds = trades.map(t => t.id);
    const { data: existing } = await supabase
      .from('brain_signal_memory')
      .select('signal_id')
      .in('signal_id', tradeIds);

    const existingIds = new Set((existing || []).map(e => e.signal_id));

    for (const trade of trades) {
      try {
        if (existingIds.has(trade.id)) {
          skipped++;
          continue;
        }

        const outcome = trade.pnl_usd > 0 ? 'win' : trade.pnl_usd < 0 ? 'loss' : 'breakeven';
        const entryFeatures = trade.entry_features || {};

        const record = {
          signal_id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          entry_price: trade.entry_price,
          exit_price: trade.exit_price,
          resolved_pnl: trade.pnl_usd || 0,
          resolved_pnl_pct: trade.pnl_pct || 0,
          strategy: trade.strategy || 'unknown',
          timeframe: trade.timeframe || '15m',
          confidence: trade.confidence || 0.5,
          outcome,
          exit_reason: trade.exit_reason || 'unknown',
          market_regime: trade.market_regime_at_entry || 'unknown',
          r_multiple: trade.r_multiple_at_close || 0,
          source: 'perpetual_trader',
          generated_at: trade.created_at,
          resolved_at: trade.exit_at || new Date().toISOString(),
          metadata: {
            entry_features: entryFeatures,
            pnl_pct: trade.pnl_pct,
            r_multiple: trade.r_multiple_at_close,
          },
        };

        const { error: insertErr } = await supabase
          .from('brain_signal_memory')
          .insert(record);

        if (insertErr) {
          if (insertErr.code === '23505') {
            skipped++;
          } else {
            errors.push(`Insert ${trade.id}: ${insertErr.message}`);
          }
        } else {
          ingested++;
        }
      } catch (e) {
        errors.push(`Process ${trade.id}: ${e.message}`);
      }
    }

    logger.info(`[PerpTLL] Ingested ${ingested} perpetual trades (${skipped} skipped, ${errors.length} errors)`);

    if (ingested > 0) {
      await logBrainEvent('perpetual_tll_ingest', {
        ingested,
        skipped,
        errors: errors.length,
        hours,
      });
    }
  } catch (e) {
    logger.error('[PerpTLL] Ingest error:', e.message);
    errors.push(e.message);
  }

  return { ingested, skipped, errors };
}

/**
 * Get perpetual trader strategy performance for TLL healing.
 * @param {number} [hours=72]
 * @returns {Promise<Array>}
 */
export async function getPerpetualStrategyPerformance(hours = 72) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from('perpetual_mock_trades')
      .select('strategy, pnl_usd, side, status')
      .eq('status', 'closed')
      .gte('exit_at', since);

    if (error || !data) return [];

    const strategyMap = new Map();
    for (const t of data) {
      const s = strategyMap.get(t.strategy) || { trades: 0, wins: 0, losses: 0, totalPnl: 0 };
      s.trades++;
      if (t.pnl_usd > 0) s.wins++;
      else s.losses++;
      s.totalPnl += t.pnl_usd || 0;
      strategyMap.set(t.strategy, s);
    }

    return Array.from(strategyMap.entries()).map(([name, s]) => ({
      name,
      trades: s.trades,
      wins: s.wins,
      losses: s.losses,
      winRate: s.trades > 0 ? s.wins / s.trades : 0,
      totalPnl: s.totalPnl,
      avgPnl: s.trades > 0 ? s.totalPnl / s.trades : 0,
      source: 'perpetual_trader',
    }));
  } catch (e) {
    logger.error('[PerpTLL] Strategy perf error:', e.message);
    return [];
  }
}

/**
 * Get perpetual trader bridge status for dashboard.
 * @returns {Promise<Object>}
 */
export async function getPerpetualTllSnapshot() {
  try {
    const [perf, { count: totalClosed }, { count: ingestedCount }] = await Promise.all([
      getPerpetualStrategyPerformance(168), // 7 days
      supabase.from('perpetual_mock_trades').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
      supabase.from('brain_signal_memory').select('id', { count: 'exact', head: true }).eq('source', 'perpetual_trader'),
    ]);

    return {
      totalClosedTrades: totalClosed || 0,
      ingestedIntoBrainMemory: ingestedCount || 0,
      strategyPerformance: perf,
      lastSync: new Date().toISOString(),
    };
  } catch (e) {
    logger.error('[PerpTLL] Snapshot error:', e.message);
    return {
      totalClosedTrades: 0,
      ingestedIntoBrainMemory: 0,
      strategyPerformance: [],
      lastSync: null,
      error: e.message,
    };
  }
}
