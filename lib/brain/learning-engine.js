// ============================================================
// Learning Engine — Analyzes past brain signal memory to
// generate strategy improvement suggestions.
// ============================================================

import { createClient } from '@supabase/supabase-js';

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Run the learning cycle: fetch resolved signals, group by
 * strategy/symbol/timeframe, calculate win rates, and save
 * learning reports.
 */
export async function runLearningCycle() {
  const client = supabase();
  if (!client) return { ok: false, error: 'Supabase not configured' };

  // Fetch signals that have been resolved (have a resolved_at timestamp)
  const { data: signals, error } = await client
    .from('brain_signal_memory')
    .select('*')
    .not('resolved_at', 'is', null)
    .limit(1000);

  if (error) return { ok: false, error: error.message };
  if (!signals?.length) return { ok: true, reports: [], message: 'No resolved signals to learn from' };

  // Group by strategy + symbol + timeframe
  const grouped = {};
  for (const s of signals) {
    const key = `${s.strategy}|${s.symbol}|${s.timeframe}`;
    if (!grouped[key]) grouped[key] = { wins: 0, losses: 0, total: 0, pnl: 0 };
    grouped[key].total++;
    if (s.resolved_pnl > 0) grouped[key].wins++;
    else grouped[key].losses++;
    grouped[key].pnl += s.resolved_pnl || 0;
  }

  // Build suggestions
  const suggestions = Object.entries(grouped).map(([key, stats]) => {
    const [strategy, symbol, timeframe] = key.split('|');
    return {
      strategy,
      symbol,
      timeframe,
      win_rate: stats.total ? stats.wins / stats.total : 0,
      total_signals: stats.total,
      total_pnl: Math.round(stats.pnl * 100) / 100,
      suggestion: stats.total > 0 && stats.wins / stats.total < 0.4
        ? `Consider disabling ${strategy} on ${symbol} ${timeframe} (win rate ${(stats.wins / stats.total * 100).toFixed(0)}%)`
        : 'No changes needed'
    };
  });

  // Save learning report
  const report = {
    generated_at: new Date().toISOString(),
    total_signals_analyzed: signals.length,
    suggestions,
    summary: {
      total_strategies: suggestions.length,
      strategies_to_review: suggestions.filter(s => s.win_rate < 0.4).length,
      overall_win_rate: signals.length
        ? signals.filter(s => s.resolved_pnl > 0).length / signals.length
        : 0
    }
  };

  const { error: insertErr } = await client.from('brain_learning_reports').insert(report);
  if (insertErr) console.error('[learning-engine] Failed to save report:', insertErr.message);

  // Update strategy weights
  for (const s of suggestions) {
    const weight = Math.min(1, Math.max(0.1, s.win_rate));
    await client.from('brain_strategy_weights').upsert({
      strategy: s.strategy,
      symbol: s.symbol,
      timeframe: s.timeframe,
      weight,
      updated_at: new Date().toISOString()
    }, { onConflict: 'strategy,symbol,timeframe' });
  }

  return { ok: true, reports: [report] };
}
