// ============================================================
// Outcome Recorder — Resolves pending signal outcomes
// Checks expired signals against current market price to
// determine win/loss and records the full context.
// Also ingests mock trade outcomes for TLL pattern discovery.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

const OUTCOME_TTL_HOURS = parseInt(process.env.TLL_OUTCOME_TTL_HOURS || '24', 10);
const MAX_RESOLVE_PER_CYCLE = parseInt(process.env.TLL_MAX_RESOLVE || '200', 10);

/**
 * Fetch current price for a symbol from brain_signal_memory or market API.
 */
async function getCurrentPrice(symbol) {
  try {
    // Try to get latest price from market-memory or exchange
    const { getPrice } = await import('../market-price.js');
    const price = await getPrice(symbol);
    if (price) return price;
  } catch (_) { /* fall through */ }

  // Fallback: get last known entry from brain_signal_memory
  const { data } = await supabase
    .from('brain_signal_memory')
    .select('entry_price')
    .eq('symbol', symbol)
    .not('entry_price', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(1);

  return data?.[0]?.entry_price || null;
}

/**
 * Resolve pending signals that have exceeded their TTL.
 * Compares entry price to current price to determine win/loss.
 * @returns {Promise<number>} Number of outcomes recorded
 */
export async function recordSignalOutcome() {
  const cutoff = new Date(Date.now() - OUTCOME_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Fetch signals that are pending resolution and past TTL
  const { data: signals, error } = await supabase
    .from('brain_signal_memory')
    .select('*')
    .is('resolved_at', null)
    .lt('generated_at', cutoff)
    .order('generated_at', { ascending: false })
    .limit(MAX_RESOLVE_PER_CYCLE);

  if (error) {
    logger.error('[outcome-recorder] Fetch error:', error.message);
    return 0;
  }

  if (!signals?.length) return 0;

  let resolved = 0;

  for (const signal of signals) {
    try {
      const currentPrice = await getCurrentPrice(signal.symbol);
      if (!currentPrice || !signal.entry_price) {
        // Mark as unresolved with note
        await supabase
          .from('brain_signal_memory')
          .update({
            resolved_at: new Date().toISOString(),
            resolved_pnl: 0,
            metadata: {
              ...(signal.metadata || {}),
              resolution: 'unresolved_no_price',
            },
          })
          .eq('id', signal.id);
        continue;
      }

      const entry = Number(signal.entry_price);
      const current = Number(currentPrice);
      let pnl = 0;

      if (signal.side === 'LONG') {
        pnl = (current - entry) / entry;
      } else if (signal.side === 'SHORT') {
        pnl = (entry - current) / entry;
      }

      // Cap extreme moves (exchange circuit breakers, data errors)
      pnl = Math.max(-0.5, Math.min(0.5, pnl));

      await supabase
        .from('brain_signal_memory')
        .update({
          resolved_at: new Date().toISOString(),
          resolved_pnl: pnl,
          metadata: {
            ...(signal.metadata || {}),
            resolution: 'auto_resolved',
            current_price_at_resolution: current,
            outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
          },
        })
        .eq('id', signal.id);

      resolved++;
    } catch (e) {
      logger.error(`[outcome-recorder] Failed to resolve signal ${signal.id}:`, e.message);
    }
  }

  logger.info(`[outcome-recorder] Resolved ${resolved}/${signals.length} signals`);

  // Also ingest recent mock trade outcomes so TLL pattern discovery
  // can learn from paper trading results alongside brain signals.
  try {
    const { ingestRecentMockTradeOutcomes } = await import('./mock-trading-bridge.js');
    const mockIngested = await ingestRecentMockTradeOutcomes(OUTCOME_TTL_HOURS);
    if (mockIngested > 0) {
      logger.info(`[outcome-recorder] Ingested ${mockIngested} mock trade outcomes`);
    }
  } catch (e) {
    logger.debug(`[outcome-recorder] Mock trade ingestion skipped: ${e.message}`);
  }

  return resolved;
}

/**
 * Get recent resolved outcomes for pattern discovery.
 * @param {number} [hours=48] - Lookback window
 * @returns {Promise<Array>}
 */
export async function getRecentOutcomes(hours = 48) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('brain_signal_memory')
    .select('*')
    .not('resolved_at', 'is', null)
    .gte('resolved_at', since)
    .order('resolved_at', { ascending: false })
    .limit(500);

  if (error) {
    logger.error('[outcome-recorder] getRecentOutcomes error:', error.message);
    return [];
  }

  return data || [];
}
