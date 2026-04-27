// ============================================================
// Learning Loop — Orchestrates the self-improvement cycle
// Runs periodically to: resolve outcomes, roll up strategy perf,
// generate suggestions, health-check sources, discover new APIs
// ============================================================

import { supabase } from './supabase.js';
import { recordOutcome } from './pattern-learner.js';
import { generateSuggestions } from './suggestion-engine.js';
import { discoverSources, getSources } from './data-source-manager.js';

const LOOP_ENABLED = process.env.LEARNING_LOOP_ENABLED !== 'false';

/**
 * Main learning loop entry point.
 * Called by cron or manual trigger.
 */
export async function runLearningLoop() {
  if (!LOOP_ENABLED) {
    console.log('[learning-loop] disabled via LEARNING_LOOP_ENABLED');
    return { status: 'disabled' };
  }

  const results = {
    outcomesResolved: 0,
    strategiesRolledUp: 0,
    suggestionsGenerated: 0,
    sourcesChecked: 0,
    newSourcesDiscovered: 0,
    errors: [],
  };

  console.log('[learning-loop] starting...');

  // 1. Resolve outcomes for expired signals
  try {
    const resolved = await resolveOutcomes();
    results.outcomesResolved = resolved;
  } catch (e) {
    results.errors.push(`outcomes: ${e.message}`);
  }

  // 2. Roll up strategy performance
  try {
    const rolled = await rollupStrategyPerformance();
    results.strategiesRolledUp = rolled;
  } catch (e) {
    results.errors.push(`rollup: ${e.message}`);
  }

  // 3. Generate suggestions
  try {
    const ids = await generateSuggestions();
    results.suggestionsGenerated = ids.length;
  } catch (e) {
    results.errors.push(`suggestions: ${e.message}`);
  }

  // 4. Health check data sources
  try {
    const checked = await healthCheckSources();
    results.sourcesChecked = checked;
  } catch (e) {
    results.errors.push(`health: ${e.message}`);
  }

  // 5. Auto-discover new sources
  try {
    const discoveries = await discoverSources();
    results.newSourcesDiscovered = discoveries.length;
  } catch (e) {
    results.errors.push(`discovery: ${e.message}`);
  }

  console.log('[learning-loop] complete:', JSON.stringify(results));
  return results;
}

/**
 * Check pending signals that have expired and resolve their outcome.
 */
async function resolveOutcomes() {
  const now = new Date().toISOString();

  // Find signals that are expired but have no outcome recorded
  const { data: pendingPatterns } = await supabase
    .from('signal_patterns')
    .select('signal_id, symbol, side, entry_price, take_profit, stop_loss, generated_at')
    .eq('outcome', 'pending')
    .lt('generated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(50);

  if (!pendingPatterns?.length) return 0;

  let resolved = 0;

  for (const pat of pendingPatterns) {
    try {
      // Get current price to determine outcome
      const { data: market } = await supabase
        .from('market_data')
        .select('close')
        .eq('symbol', pat.symbol)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      const currentPrice = market?.close;
      if (!currentPrice || !pat.entry_price) continue;

      let result = 'expired';
      let pnl = 0;
      let reachedTP = false;
      let reachedSL = false;

      const tps = Array.isArray(pat.take_profit) ? pat.take_profit : [];
      const sl = pat.stop_loss;

      if (pat.side === 'LONG') {
        if (sl && currentPrice <= sl) { result = 'loss'; reachedSL = true; pnl = ((sl - pat.entry_price) / pat.entry_price) * 100; }
        else if (tps.length > 0 && currentPrice >= Math.min(...tps)) { result = 'win'; reachedTP = true; pnl = ((currentPrice - pat.entry_price) / pat.entry_price) * 100; }
        else { pnl = ((currentPrice - pat.entry_price) / pat.entry_price) * 100; result = pnl > 0 ? 'breakeven' : 'loss'; }
      } else if (pat.side === 'SHORT') {
        if (sl && currentPrice >= sl) { result = 'loss'; reachedSL = true; pnl = ((pat.entry_price - sl) / pat.entry_price) * 100; }
        else if (tps.length > 0 && currentPrice <= Math.max(...tps)) { result = 'win'; reachedTP = true; pnl = ((pat.entry_price - currentPrice) / pat.entry_price) * 100; }
        else { pnl = ((pat.entry_price - currentPrice) / pat.entry_price) * 100; result = pnl > 0 ? 'breakeven' : 'loss'; }
      }

      const durationMinutes = Math.round((Date.now() - new Date(pat.generated_at).getTime()) / 60000);

      await recordOutcome(pat.signal_id, {
        result,
        pnl,
        reachedTP,
        reachedSL,
        durationMinutes,
        filledAt: now,
      });

      resolved++;
    } catch (e) {
      console.warn(`[learning-loop] resolve failed for ${pat.signal_id}:`, e.message);
    }
  }

  return resolved;
}

/**
 * Roll up strategy performance for the last 7 days.
 */
async function rollupStrategyPerformance() {
  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date().toISOString();

  const { data: patterns } = await supabase
    .from('signal_patterns')
    .select('strategy, timeframe, symbol, outcome, outcome_pnl, outcome_duration_minutes, confidence, generated_at')
    .not('outcome', 'is', null)
    .gte('generated_at', windowStart)
    .lte('generated_at', windowEnd);

  if (!patterns?.length) return 0;

  // Group by strategy+timeframe+symbol
  const groups = {};
  for (const p of patterns) {
    const key = `${p.strategy}|${p.timeframe}|${p.symbol || 'all'}`;
    groups[key] = groups[key] || [];
    groups[key].push(p);
  }

  let rolled = 0;
  for (const [key, items] of Object.entries(groups)) {
    const [strategy, timeframe, symbol] = key.split('|');
    const wins = items.filter(i => i.outcome === 'win').length;
    const losses = items.filter(i => i.outcome === 'loss').length;
    const breakevens = items.filter(i => i.outcome === 'breakeven').length;
    const expired = items.filter(i => i.outcome === 'expired').length;
    const pnls = items.map(i => Number(i.outcome_pnl || 0));
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const avgPnl = totalPnl / items.length;
    const winRate = items.length > 0 ? wins / items.length : 0;
    const avgConf = items.reduce((a, i) => a + Number(i.confidence || 0), 0) / items.length;
    const avgDuration = items.reduce((a, i) => a + (i.outcome_duration_minutes || 0), 0) / items.length;

    const { error } = await supabase
      .from('strategy_performance')
      .upsert({
        strategy,
        timeframe,
        symbol: symbol === 'all' ? null : symbol,
        window_start: windowStart,
        window_end: windowEnd,
        signals_count: items.length,
        wins,
        losses,
        breakevens,
        expired,
        win_rate: winRate,
        avg_pnl: avgPnl,
        total_pnl: totalPnl,
        avg_confidence: avgConf,
        avg_duration_minutes: Math.round(avgDuration),
      }, { onConflict: 'strategy,timeframe,symbol,market_regime,window_start' });

    if (!error) rolled++;
  }

  return rolled;
}

/**
 * Basic health check of all active sources.
 */
async function healthCheckSources() {
  const sources = await getSources({ status: 'active' });
  let checked = 0;

  for (const src of sources) {
    const lastSuccess = src.last_success_at ? new Date(src.last_success_at).getTime() : 0;
    const hoursSince = (Date.now() - lastSuccess) / 3600000;

    if (hoursSince > 6) {
      // Mark as degraded if no success in 6 hours
      await supabase
        .from('data_source_registry')
        .update({ status: 'degraded', last_error_message: 'No successful request in 6+ hours' })
        .eq('name', src.name);
    }
    checked++;
  }

  return checked;
}
