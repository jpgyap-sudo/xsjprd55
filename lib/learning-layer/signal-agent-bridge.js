// ============================================================
// Signal Agent Bridge — Feeds signal agent data
// into the Trading Learning Layer (TLL) for pattern discovery,
// skill generation, and strategy healing.
//
// Bridges:
//   signal_memory → brain_signal_memory (outcome enrichment)
//   signal_patterns → brain_signal_memory (pattern enrichment)
//   strategy_performance → tll_healing_log (strategy health)
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { logBrainEvent } from '../brain/brain-telemetry.js';

const MAX_RESOLVE = parseInt(process.env.TLL_MAX_RESOLVE || '200', 10);

/**
 * Ingest signal_memory records into brain_signal_memory.
 * This bridges the signal generator's memory table into the TLL.
 * Dedup by signal_id.
 * @param {number} [hours=48] — Look back window
 * @returns {Promise<{ingested: number, skipped: number, errors: string[]}>}
 */
export async function ingestSignalMemory(hours = 48) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const errors = [];
  let ingested = 0;
  let skipped = 0;

  try {
    const { data: memories, error } = await supabase
      .from('signal_memory')
      .select('signal_id, symbol, side, entry_price, stop_loss, take_profit, confidence, strategy, timeframe, generated_at, source, mode, outcome, outcome_pnl, risk_reward, market_ctx, description')
      .gte('generated_at', since)
      .order('generated_at', { ascending: false })
      .limit(MAX_RESOLVE);

    if (error) {
      logger.error('[SigBridge] Signal memory fetch error:', error.message);
      return { ingested: 0, skipped: 0, errors: [error.message] };
    }

    if (!memories || memories.length === 0) {
      return { ingested: 0, skipped: 0, errors: [] };
    }

    // Dedup by signal_id
    const signalIds = memories.map(m => m.signal_id);
    const { data: existing } = await supabase
      .from('brain_signal_memory')
      .select('signal_id')
      .in('signal_id', signalIds);

    const existingIds = new Set((existing || []).map(e => e.signal_id));

    for (const mem of memories) {
      try {
        if (existingIds.has(mem.signal_id)) {
          skipped++;
          continue;
        }

        // Map signal_memory outcome to brain_signal_memory outcome
        let outcome = 'pending';
        if (mem.outcome && mem.outcome !== 'pending') {
          outcome = mem.outcome;
        }

        const record = {
          signal_id: mem.signal_id,
          symbol: mem.symbol,
          side: mem.side,
          entry_price: mem.entry_price || 0,
          exit_price: 0, // Will be filled when trade closes
          resolved_pnl: mem.outcome_pnl || 0,
          resolved_pnl_pct: 0,
          strategy: mem.strategy || 'unknown',
          timeframe: mem.timeframe || '15m',
          confidence: mem.confidence || 0.5,
          outcome,
          exit_reason: outcome !== 'pending' ? 'signal_memory_resolved' : 'pending',
          market_regime: 'unknown',
          r_multiple: mem.risk_reward || 0,
          source: 'signal_agent_memory',
          generated_at: mem.generated_at,
          resolved_at: outcome !== 'pending' ? new Date().toISOString() : null,
          metadata: {
            signal_source: mem.source,
            signal_mode: mem.mode,
            risk_reward: mem.risk_reward,
            market_ctx: mem.market_ctx,
            description: mem.description ? mem.description.slice(0, 200) : null,
          },
        };

        const { error: insertErr } = await supabase
          .from('brain_signal_memory')
          .insert(record);

        if (insertErr) {
          if (insertErr.code === '23505') {
            skipped++;
          } else {
            errors.push(`Insert ${mem.signal_id}: ${insertErr.message}`);
          }
        } else {
          ingested++;
        }
      } catch (e) {
        errors.push(`Process ${mem.signal_id}: ${e.message}`);
      }
    }

    logger.info(`[SigBridge] Ingested ${ingested} signal memories (${skipped} skipped, ${errors.length} errors)`);

    if (ingested > 0) {
      await logBrainEvent('signal_agent_memory_ingest', {
        ingested,
        skipped,
        errors: errors.length,
        hours,
      });
    }
  } catch (e) {
    logger.error('[SigBridge] Signal memory ingest error:', e.message);
    errors.push(e.message);
  }

  return { ingested, skipped, errors };
}

/**
 * Ingest signal_patterns into brain_signal_memory.
 * Signal patterns contain resolved outcomes that the TLL can learn from.
 * @param {number} [hours=72] — Look back window
 * @returns {Promise<{ingested: number, skipped: number, errors: string[]}>}
 */
export async function ingestSignalPatterns(hours = 72) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const errors = [];
  let ingested = 0;
  let skipped = 0;

  try {
    const { data: patterns, error } = await supabase
      .from('signal_patterns')
      .select('signal_id, symbol, side, entry_price, take_profit, stop_loss, strategy, timeframe, confidence, outcome, outcome_pnl, outcome_duration_minutes, generated_at')
      .not('outcome', 'is', null)
      .neq('outcome', 'pending')
      .gte('generated_at', since)
      .order('generated_at', { ascending: false })
      .limit(MAX_RESOLVE);

    if (error) {
      logger.error('[SigBridge] Signal patterns fetch error:', error.message);
      return { ingested: 0, skipped: 0, errors: [error.message] };
    }

    if (!patterns || patterns.length === 0) {
      return { ingested: 0, skipped: 0, errors: [] };
    }

    // Use prefixed signal IDs to avoid collision
    const signalIds = patterns.map(p => `pattern_${p.signal_id}`);
    const { data: existing } = await supabase
      .from('brain_signal_memory')
      .select('signal_id')
      .in('signal_id', signalIds);

    const existingIds = new Set((existing || []).map(e => e.signal_id));

    for (const pat of patterns) {
      try {
        const signalId = `pattern_${pat.signal_id}`;
        if (existingIds.has(signalId)) {
          skipped++;
          continue;
        }

        const record = {
          signal_id: signalId,
          symbol: pat.symbol,
          side: pat.side || 'LONG',
          entry_price: pat.entry_price || 0,
          exit_price: 0,
          resolved_pnl: pat.outcome_pnl || 0,
          resolved_pnl_pct: pat.outcome_pnl || 0,
          strategy: pat.strategy || 'unknown',
          timeframe: pat.timeframe || '15m',
          confidence: pat.confidence || 0.5,
          outcome: pat.outcome || 'breakeven',
          exit_reason: 'pattern_resolved',
          market_regime: 'unknown',
          r_multiple: 0,
          source: 'signal_agent_pattern',
          generated_at: pat.generated_at,
          resolved_at: new Date().toISOString(),
          metadata: {
            original_signal_id: pat.signal_id,
            outcome_duration_minutes: pat.outcome_duration_minutes,
            take_profit: pat.take_profit,
            stop_loss: pat.stop_loss,
          },
        };

        const { error: insertErr } = await supabase
          .from('brain_signal_memory')
          .insert(record);

        if (insertErr) {
          if (insertErr.code === '23505') {
            skipped++;
          } else {
            errors.push(`Insert ${signalId}: ${insertErr.message}`);
          }
        } else {
          ingested++;
        }
      } catch (e) {
        errors.push(`Process pattern ${pat.signal_id}: ${e.message}`);
      }
    }

    logger.info(`[SigBridge] Ingested ${ingested} signal patterns (${skipped} skipped, ${errors.length} errors)`);

    if (ingested > 0) {
      await logBrainEvent('signal_agent_pattern_ingest', {
        ingested,
        skipped,
        errors: errors.length,
        hours,
      });
    }
  } catch (e) {
    logger.error('[SigBridge] Signal patterns ingest error:', e.message);
    errors.push(e.message);
  }

  return { ingested, skipped, errors };
}

/**
 * Sync strategy_performance into TLL healing context.
 * This feeds the strategy healer with signal agent performance data.
 * @returns {Promise<{synced: number, errors: string[]}>}
 */
export async function syncStrategyPerformanceToHealing() {
  const errors = [];
  let synced = 0;

  try {
    const { data: performances, error } = await supabase
      .from('strategy_performance')
      .select('*')
      .order('window_end', { ascending: false })
      .limit(100);

    if (error) {
      logger.error('[SigBridge] Strategy perf fetch error:', error.message);
      return { synced: 0, errors: [error.message] };
    }

    if (!performances || performances.length === 0) {
      return { synced: 0, errors: [] };
    }

    for (const perf of performances) {
      try {
        // Check if this strategy+window already has a healing record
        const windowKey = `${perf.strategy}|${perf.window_start || 'unknown'}`;
        const { data: existingHealing } = await supabase
          .from('tll_healing_log')
          .select('id')
          .eq('strategy', perf.strategy)
          .eq('source', 'signal_agent_performance')
          .order('healed_at', { ascending: false })
          .limit(1);

        // Skip if already synced for this window
        if (existingHealing && existingHealing.length > 0) {
          const existingMeta = existingHealing[0];
          // Simple check: if healing record exists, skip
          continue;
        }

        const winRate = perf.signals_count > 0 ? perf.wins / perf.signals_count : 0;
        const suggestion = winRate >= 0.5
          ? `Strategy "${perf.strategy}" performing well on ${perf.timeframe}/${perf.symbol || 'all'}. Win rate: ${(winRate * 100).toFixed(1)}%, PnL: ${perf.total_pnl?.toFixed(2) || 0}.`
          : `Strategy "${perf.strategy}" underperforming on ${perf.timeframe}/${perf.symbol || 'all'}. Win rate: ${(winRate * 100).toFixed(1)}%, PnL: ${perf.total_pnl?.toFixed(2) || 0}. Consider review.`;

        const { error: insertErr } = await supabase
          .from('tll_healing_log')
          .insert({
            strategy: perf.strategy,
            win_rate: winRate,
            avg_pnl: perf.avg_pnl || 0,
            signals_count: perf.signals_count || 0,
            suggestion,
            action_taken: winRate >= 0.5 ? 'monitor' : winRate < 0.4 ? 'review' : 'monitor',
            healed_at: new Date().toISOString(),
            source: 'signal_agent_performance',
            metadata: {
              timeframe: perf.timeframe,
              symbol: perf.symbol,
              window_start: perf.window_start,
              window_end: perf.window_end,
              wins: perf.wins,
              losses: perf.losses,
              breakevens: perf.breakevens,
              expired: perf.expired,
              total_pnl: perf.total_pnl,
              avg_confidence: perf.avg_confidence,
              avg_duration_minutes: perf.avg_duration_minutes,
            },
          });

        if (insertErr) {
          errors.push(`Insert healing ${perf.strategy}: ${insertErr.message}`);
        } else {
          synced++;
        }
      } catch (e) {
        errors.push(`Process perf ${perf.strategy}: ${e.message}`);
      }
    }

    logger.info(`[SigBridge] Synced ${synced} strategy performances to healing (${errors.length} errors)`);

    if (synced > 0) {
      await logBrainEvent('signal_agent_healing_sync', {
        synced,
        errors: errors.length,
      });
    }
  } catch (e) {
    logger.error('[SigBridge] Strategy perf sync error:', e.message);
    errors.push(e.message);
  }

  return { synced, errors };
}

/**
 * Get signal agent bridge status for dashboard.
 * @returns {Promise<Object>}
 */
export async function getSignalAgentTllSnapshot() {
  try {
    const [
      { count: memoryCount },
      { count: patternCount },
      { count: perfCount },
      { count: ingestedMemory },
      { count: ingestedPatterns },
    ] = await Promise.all([
      supabase.from('signal_memory').select('id', { count: 'exact', head: true }),
      supabase.from('signal_patterns').select('id', { count: 'exact', head: true }).not('outcome', 'is', null).neq('outcome', 'pending'),
      supabase.from('strategy_performance').select('id', { count: 'exact', head: true }),
      supabase.from('brain_signal_memory').select('id', { count: 'exact', head: true }).eq('source', 'signal_agent_memory'),
      supabase.from('brain_signal_memory').select('id', { count: 'exact', head: true }).eq('source', 'signal_agent_pattern'),
    ]);

    return {
      totalSignalMemory: memoryCount || 0,
      totalResolvedPatterns: patternCount || 0,
      totalStrategyPerformance: perfCount || 0,
      ingestedIntoBrainMemory: (ingestedMemory || 0) + (ingestedPatterns || 0),
      lastSync: new Date().toISOString(),
    };
  } catch (e) {
    logger.error('[SigBridge] Snapshot error:', e.message);
    return {
      totalSignalMemory: 0,
      totalResolvedPatterns: 0,
      totalStrategyPerformance: 0,
      ingestedIntoBrainMemory: 0,
      lastSync: null,
      error: e.message,
    };
  }
}
