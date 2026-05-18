// ============================================================
// Research Agent Bridge — Feeds research agent data
// into the Trading Learning Layer (TLL) for pattern discovery,
// skill generation, and strategy healing.
//
// Bridges:
//   strategy_proposals → brain_signal_memory (as synthetic signals)
//   backtest_results → brain_signal_memory (as synthetic signals)
//   mock_strategy_feedback → tll_healing_log (strategy health)
//   strategy_lifecycle → brain_events (lifecycle telemetry)
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { logBrainEvent } from '../brain/brain-telemetry.js';

const MAX_RESOLVE = parseInt(process.env.TLL_MAX_RESOLVE || '200', 10);

/**
 * Ingest backtest results into brain_signal_memory as synthetic signals.
 * This allows the TLL pattern discoverer to learn from backtest data.
 * @param {number} [hours=168] — Look back window (default 7 days)
 * @returns {Promise<{ingested: number, skipped: number, errors: string[]}>}
 */
export async function ingestBacktestResults(hours = 168) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const errors = [];
  let ingested = 0;
  let skipped = 0;

  try {
    // Fetch recent backtest results
    const { data: backtests, error } = await supabase
      .from('backtest_results')
      .select('id, strategy_name, symbol, total_return_pct, total_trades, win_rate, sharpe_ratio, max_drawdown_pct, profit_factor, expectancy, run_at')
      .gte('run_at', since)
      .order('run_at', { ascending: false })
      .limit(MAX_RESOLVE);

    if (error) {
      logger.error('[RABridge] Backtest fetch error:', error.message);
      return { ingested: 0, skipped: 0, errors: [error.message] };
    }

    if (!backtests || backtests.length === 0) {
      return { ingested: 0, skipped: 0, errors: [] };
    }

    // Dedup by signal_id (prefixed to avoid collision with other sources)
    const signalIds = backtests.map(b => `backtest_${b.id}`);
    const { data: existing } = await supabase
      .from('brain_signal_memory')
      .select('signal_id')
      .in('signal_id', signalIds);

    const existingIds = new Set((existing || []).map(e => e.signal_id));

    for (const bt of backtests) {
      try {
        const signalId = `backtest_${bt.id}`;
        if (existingIds.has(signalId)) {
          skipped++;
          continue;
        }

        const outcome = bt.total_return_pct > 0 ? 'win' : bt.total_return_pct < 0 ? 'loss' : 'breakeven';
        const syntheticPnl = (bt.total_return_pct || 0) * 10; // Scale to USD-like value

        const record = {
          signal_id: signalId,
          symbol: bt.symbol || 'BTCUSDT',
          side: 'LONG', // Backtests don't track side per-trade, default to LONG
          entry_price: 0,
          exit_price: 0,
          resolved_pnl: syntheticPnl,
          resolved_pnl_pct: bt.total_return_pct || 0,
          strategy: bt.strategy_name || 'unknown_backtest',
          timeframe: '1h', // Backtests are typically multi-timeframe
          confidence: bt.win_rate || 0.5,
          outcome,
          exit_reason: 'backtest_complete',
          market_regime: 'unknown',
          r_multiple: 0,
          source: 'research_agent_backtest',
          generated_at: bt.run_at,
          resolved_at: bt.run_at,
          metadata: {
            total_trades: bt.total_trades,
            win_rate: bt.win_rate,
            sharpe_ratio: bt.sharpe_ratio,
            max_drawdown_pct: bt.max_drawdown_pct,
            profit_factor: bt.profit_factor,
            expectancy: bt.expectancy,
            is_backtest: true,
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
        errors.push(`Process backtest ${bt.id}: ${e.message}`);
      }
    }

    logger.info(`[RABridge] Ingested ${ingested} backtest results (${skipped} skipped, ${errors.length} errors)`);

    if (ingested > 0) {
      await logBrainEvent('research_agent_backtest_ingest', {
        ingested,
        skipped,
        errors: errors.length,
        hours,
      });
    }
  } catch (e) {
    logger.error('[RABridge] Backtest ingest error:', e.message);
    errors.push(e.message);
  }

  return { ingested, skipped, errors };
}

/**
 * Ingest strategy proposals into brain_signal_memory as synthetic signals.
 * This allows the TLL to learn from research-derived strategy ideas.
 * @param {number} [hours=336] — Look back window (default 14 days)
 * @returns {Promise<{ingested: number, skipped: number, errors: string[]}>}
 */
export async function ingestStrategyProposals(hours = 336) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const errors = [];
  let ingested = 0;
  let skipped = 0;

  try {
    const { data: proposals, error } = await supabase
      .from('strategy_proposals')
      .select('id, name, description, confidence, rules_json, source_name, source_credibility, created_at, promoted, rejected, tested')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_RESOLVE);

    if (error) {
      logger.error('[RABridge] Proposals fetch error:', error.message);
      return { ingested: 0, skipped: 0, errors: [error.message] };
    }

    if (!proposals || proposals.length === 0) {
      return { ingested: 0, skipped: 0, errors: [] };
    }

    const signalIds = proposals.map(p => `proposal_${p.id}`);
    const { data: existing } = await supabase
      .from('brain_signal_memory')
      .select('signal_id')
      .in('signal_id', signalIds);

    const existingIds = new Set((existing || []).map(e => e.signal_id));

    for (const prop of proposals) {
      try {
        const signalId = `proposal_${prop.id}`;
        if (existingIds.has(signalId)) {
          skipped++;
          continue;
        }

        // Determine outcome based on promotion/rejection status
        let outcome = 'pending';
        let resolvedPnl = 0;
        if (prop.promoted) {
          outcome = 'win';
          resolvedPnl = 100; // Promoted = positive signal
        } else if (prop.rejected) {
          outcome = 'loss';
          resolvedPnl = -100; // Rejected = negative signal
        } else if (prop.tested) {
          outcome = 'breakeven'; // Tested but not promoted/rejected = neutral
        }

        const record = {
          signal_id: signalId,
          symbol: 'MULTI',
          side: 'LONG',
          entry_price: 0,
          exit_price: 0,
          resolved_pnl: resolvedPnl,
          resolved_pnl_pct: 0,
          strategy: prop.name || 'unknown_proposal',
          timeframe: '1h',
          confidence: prop.confidence || 0.5,
          outcome,
          exit_reason: prop.promoted ? 'promoted' : prop.rejected ? 'rejected' : prop.tested ? 'tested' : 'pending',
          market_regime: 'unknown',
          r_multiple: 0,
          source: 'research_agent_proposal',
          generated_at: prop.created_at,
          resolved_at: prop.promoted || prop.rejected ? new Date().toISOString() : null,
          metadata: {
            description: prop.description,
            rules_json: prop.rules_json,
            source_name: prop.source_name,
            source_credibility: prop.source_credibility,
            is_proposal: true,
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
        errors.push(`Process proposal ${prop.id}: ${e.message}`);
      }
    }

    logger.info(`[RABridge] Ingested ${ingested} strategy proposals (${skipped} skipped, ${errors.length} errors)`);

    if (ingested > 0) {
      await logBrainEvent('research_agent_proposal_ingest', {
        ingested,
        skipped,
        errors: errors.length,
        hours,
      });
    }
  } catch (e) {
    logger.error('[RABridge] Proposals ingest error:', e.message);
    errors.push(e.message);
  }

  return { ingested, skipped, errors };
}

/**
 * Sync mock_strategy_feedback into TLL healing context.
 * Promoted/rejected strategies inform the strategy healer.
 * @returns {Promise<{synced: number, errors: string[]}>}
 */
export async function syncStrategyFeedbackToHealing() {
  const errors = [];
  let synced = 0;

  try {
    const { data: feedbacks, error } = await supabase
      .from('mock_strategy_feedback')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      logger.error('[RABridge] Feedback fetch error:', error.message);
      return { synced: 0, errors: [error.message] };
    }

    if (!feedbacks || feedbacks.length === 0) {
      return { synced: 0, errors: [] };
    }

    for (const fb of feedbacks) {
      try {
        // Check if this strategy already has a healing record
        const { data: existingHealing } = await supabase
          .from('tll_healing_log')
          .select('id')
          .eq('strategy', fb.strategy_name)
          .eq('source', 'research_agent_feedback')
          .limit(1);

        if (existingHealing && existingHealing.length > 0) {
          continue; // Already synced
        }

        const winRate = fb.trades > 0 ? fb.wins / fb.trades : 0;
        const suggestion = fb.promoted
          ? `Strategy "${fb.strategy_name}" promoted by research agent (score: ${fb.feedback_score}). ${fb.trades} trades, ${(winRate * 100).toFixed(1)}% win rate.`
          : `Strategy "${fb.strategy_name}" reviewed by research agent. ${fb.trades} trades, ${(winRate * 100).toFixed(1)}% win rate, PnL: $${fb.total_pnl_usd}.`;

        const { error: insertErr } = await supabase
          .from('tll_healing_log')
          .insert({
            strategy: fb.strategy_name,
            win_rate: winRate,
            avg_pnl: fb.trades > 0 ? fb.total_pnl_usd / fb.trades : 0,
            signals_count: fb.trades,
            suggestion,
            action_taken: fb.promoted ? 'promote' : fb.feedback_score < 0 ? 'review' : 'monitor',
            healed_at: new Date().toISOString(),
            source: 'research_agent_feedback',
            metadata: {
              feedback_score: fb.feedback_score,
              total_pnl_usd: fb.total_pnl_usd,
              max_drawdown_pct: fb.max_drawdown_pct,
              promoted: fb.promoted,
            },
          });

        if (insertErr) {
          errors.push(`Insert healing ${fb.strategy_name}: ${insertErr.message}`);
        } else {
          synced++;
        }
      } catch (e) {
        errors.push(`Process feedback ${fb.strategy_name}: ${e.message}`);
      }
    }

    logger.info(`[RABridge] Synced ${synced} strategy feedbacks to healing (${errors.length} errors)`);

    if (synced > 0) {
      await logBrainEvent('research_agent_healing_sync', {
        synced,
        errors: errors.length,
      });
    }
  } catch (e) {
    logger.error('[RABridge] Feedback sync error:', e.message);
    errors.push(e.message);
  }

  return { synced, errors };
}

/**
 * Get research agent bridge status for dashboard.
 * @returns {Promise<Object>}
 */
export async function getResearchAgentTllSnapshot() {
  try {
    const [
      { count: backtestCount },
      { count: proposalCount },
      { count: feedbackCount },
      { count: lifecycleCount },
      { count: ingestedBacktests },
      { count: ingestedProposals },
    ] = await Promise.all([
      supabase.from('backtest_results').select('id', { count: 'exact', head: true }),
      supabase.from('strategy_proposals').select('id', { count: 'exact', head: true }),
      supabase.from('mock_strategy_feedback').select('id', { count: 'exact', head: true }),
      supabase.from('strategy_lifecycle').select('id', { count: 'exact', head: true }),
      supabase.from('brain_signal_memory').select('id', { count: 'exact', head: true }).eq('source', 'research_agent_backtest'),
      supabase.from('brain_signal_memory').select('id', { count: 'exact', head: true }).eq('source', 'research_agent_proposal'),
    ]);

    return {
      totalBacktests: backtestCount || 0,
      totalProposals: proposalCount || 0,
      totalFeedback: feedbackCount || 0,
      totalLifecycle: lifecycleCount || 0,
      ingestedIntoBrainMemory: (ingestedBacktests || 0) + (ingestedProposals || 0),
      lastSync: new Date().toISOString(),
    };
  } catch (e) {
    logger.error('[RABridge] Snapshot error:', e.message);
    return {
      totalBacktests: 0,
      totalProposals: 0,
      totalFeedback: 0,
      totalLifecycle: 0,
      ingestedIntoBrainMemory: 0,
      lastSync: null,
      error: e.message,
    };
  }
}
