// ============================================================
// Strategy Healer — Auto-quarantines underperforming strategies
// and suggests replacements based on discovered patterns.
//
// Like SuperRoo's self-healing but for trading strategies:
// - Flags strategies with win rate < 40%
// - Suggests parameter adjustments
// - Recommends strategy swaps based on current regime
// - Also checks mock trading strategy performance
// v2: Uses Ollama for richer, context-aware healing suggestions
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

const MIN_SIGNALS_FOR_HEAL = 10;
const LOW_WIN_RATE_THRESHOLD = 0.4;
const QUARANTINE_WIN_RATE = 0.25;

/**
 * Generate a healing suggestion using Ollama for richer analysis.
 */
async function generateHealingWithOllama(strategy, winRate, avgPnl, signals, sideBreakdown) {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  const summary = {
    strategy,
    winRate: Number(winRate.toFixed(2)),
    avgPnl: Number(avgPnl.toFixed(6)),
    totalSignals: signals.length,
    sideBreakdown,
    symbols: [...new Set(signals.map(s => s.symbol).filter(Boolean))].slice(0, 5),
    timeframes: [...new Set(signals.map(s => s.timeframe).filter(Boolean))].slice(0, 5)
  };

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a trading strategy healer. Given strategy performance data, suggest specific improvements. Return ONLY a JSON object:
{
  "suggestion": "<specific actionable suggestion, 1-2 sentences>",
  "rootCause": "<likely root cause>",
  "parameterChanges": ["<change1>", "<change2>"],
  "alternativeStrategy": "<suggested alternative strategy type>"
}
Do NOT include any other text.`
          },
          {
            role: 'user',
            content: JSON.stringify(summary)
          }
        ],
        options: { temperature: 0.2, max_tokens: 256 }
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json();
    const content = data.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.debug(`[strategy-healer] Ollama unavailable: ${err.message}`);
    return null;
  }
}

/**
 * Generate a specific healing suggestion based on strategy data.
 * Uses Ollama when available, falls back to rule-based logic.
 */
async function generateHealingSuggestion(strategy, winRate, avgPnl, signals) {
  const sideBreakdown = {};
  for (const s of signals) {
    const side = s.side || 'UNKNOWN';
    if (!sideBreakdown[side]) sideBreakdown[side] = { wins: 0, losses: 0, total: 0 };
    sideBreakdown[side].total++;
    if (Number(s.resolved_pnl || 0) > 0) sideBreakdown[side].wins++;
    else sideBreakdown[side].losses++;
  }

  // Try Ollama for richer suggestion
  try {
    const ollamaResult = await generateHealingWithOllama(strategy, winRate, avgPnl, signals, sideBreakdown);
    if (ollamaResult && ollamaResult.suggestion) {
      return ollamaResult.suggestion;
    }
  } catch (e) {
    // Fall through to rule-based
  }

  // Rule-based fallback
  let sideAdvice = '';
  for (const [side, stats] of Object.entries(sideBreakdown)) {
    if (stats.total >= 5) {
      const sideWinRate = stats.wins / stats.total;
      if (sideWinRate > 0.5) {
        sideAdvice = ` Consider only ${side} signals (${(sideWinRate * 100).toFixed(0)}% win rate).`;
      }
    }
  }

  return `Strategy "${strategy}" has ${(winRate * 100).toFixed(0)}% win rate (avg PnL: ${(avgPnl * 100).toFixed(2)}%).${sideAdvice} Recommended: ${winRate < 0.25 ? 'Disable and replace with regime-matched strategy.' : 'Adjust entry filters or combine with complementary strategy.'}`;
}

/**
 * Analyze strategy performance and generate healing suggestions.
 * @returns {Promise<number>} Number of strategies healed/quarantined
 */
export async function healStrategies() {
  // Fetch resolved signals grouped by strategy
  const { data: signals, error } = await supabase
    .from('brain_signal_memory')
    .select('strategy, side, resolved_pnl, resolved_at, symbol, timeframe')
    .not('resolved_at', 'is', null)
    .gte('resolved_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(1000);

  if (error) {
    logger.error('[strategy-healer] Fetch error:', error.message);
    return 0;
  }

  if (!signals?.length) return 0;

  // Group by strategy
  const byStrategy = {};
  for (const s of signals) {
    const key = s.strategy || 'unknown';
    if (!byStrategy[key]) byStrategy[key] = [];
    byStrategy[key].push(s);
  }

  let healed = 0;

  for (const [strategy, groupSignals] of Object.entries(byStrategy)) {
    if (groupSignals.length < MIN_SIGNALS_FOR_HEAL) continue;

    const wins = groupSignals.filter((s) => Number(s.resolved_pnl || 0) > 0).length;
    const losses = groupSignals.filter((s) => Number(s.resolved_pnl || 0) < 0).length;
    const total = groupSignals.length;
    const winRate = total > 0 ? wins / total : 0;
    const totalPnl = groupSignals.reduce((s, t) => s + Number(t.resolved_pnl || 0), 0);
    const avgPnl = totalPnl / total;

    if (winRate >= LOW_WIN_RATE_THRESHOLD) continue; // Healthy

    const needsQuarantine = winRate < QUARANTINE_WIN_RATE;

    // Generate healing suggestion (async with Ollama)
    const suggestionText = await generateHealingSuggestion(strategy, winRate, avgPnl, groupSignals);

    const suggestion = {
      strategy,
      total_signals: total,
      wins,
      losses,
      win_rate: Number(winRate.toFixed(4)),
      avg_pnl: Number(avgPnl.toFixed(6)),
      total_pnl: Number(totalPnl.toFixed(6)),
      action: needsQuarantine ? 'quarantine' : 'review',
      reason: needsQuarantine
        ? `Win rate ${(winRate * 100).toFixed(0)}% is critically low — auto-quarantined`
        : `Win rate ${(winRate * 100).toFixed(0)}% below ${(LOW_WIN_RATE_THRESHOLD * 100).toFixed(0)}% threshold — needs review`,
      suggestion: suggestionText,
      healed_at: new Date().toISOString(),
    };

    // Save healing record
    try {
      const { error: insertErr } = await supabase.from('tll_healing_log').insert(suggestion);
      if (insertErr) {
        logger.error(`[strategy-healer] Insert error for ${strategy}:`, insertErr.message);
      }
    } catch (e) {
      logger.error(`[strategy-healer] Save error for ${strategy}:`, e.message);
    }

    // If quarantining, set strategy weight to minimum
    if (needsQuarantine) {
      await supabase
        .from('brain_strategy_weights')
        .update({
          weight: 0.05,
          updated_at: new Date().toISOString(),
          metadata: {
            quarantined: true,
            quarantined_at: new Date().toISOString(),
            win_rate_at_quarantine: winRate,
            reason: suggestion.reason,
          },
        })
        .eq('strategy', strategy);
    }

    healed++;
  }

  // ── Also check mock trading strategy performance ──────────
  try {
    const mockHealed = await healMockStrategies();
    healed += mockHealed;
  } catch (e) {
    logger.warn(`[strategy-healer] Mock strategy healing failed: ${e.message}`);
  }

  logger.info(`[strategy-healer] Processed ${healed} underperforming strategies`);
  return healed;
}

/**
 * Check mock trading strategy performance and apply healing.
 * Reads from mock_trades table and strategy_scorecard.
 */
async function healMockStrategies() {
  // Fetch closed mock trades grouped by strategy_name from last 7 days
  const { data: mockSignals, error } = await supabase
    .from('mock_trades')
    .select('strategy_name, side, pnl_pct, pnl_usd, closed_at, symbol, leverage')
    .eq('status', 'closed')
    .gte('closed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(2000);

  if (error) {
    logger.error('[strategy-healer] Mock trades fetch error:', error.message);
    return 0;
  }

  if (!mockSignals?.length) return 0;

  // Group by strategy
  const byStrategy = {};
  for (const s of mockSignals) {
    const key = s.strategy_name || 'unknown';
    if (!byStrategy[key]) byStrategy[key] = [];
    byStrategy[key].push(s);
  }

  let healed = 0;

  for (const [strategy, groupSignals] of Object.entries(byStrategy)) {
    if (groupSignals.length < MIN_SIGNALS_FOR_HEAL) continue;

    const wins = groupSignals.filter((s) => Number(s.pnl_usd || 0) > 0).length;
    const total = groupSignals.length;
    const winRate = total > 0 ? wins / total : 0;
    const totalPnl = groupSignals.reduce((s, t) => s + Number(t.pnl_usd || 0), 0);
    const avgPnl = totalPnl / total;

    if (winRate >= LOW_WIN_RATE_THRESHOLD) continue;

    const needsQuarantine = winRate < QUARANTINE_WIN_RATE;

    // Generate Ollama-enhanced suggestion for mock strategies too
    const sideBreakdown = {};
    for (const s of groupSignals) {
      const side = s.side || 'UNKNOWN';
      if (!sideBreakdown[side]) sideBreakdown[side] = { wins: 0, losses: 0, total: 0 };
      sideBreakdown[side].total++;
      if (Number(s.pnl_usd || 0) > 0) sideBreakdown[side].wins++;
      else sideBreakdown[side].losses++;
    }

    let suggestionText = '';
    try {
      const ollamaResult = await generateHealingWithOllama(`mock_${strategy}`, winRate, avgPnl, groupSignals, sideBreakdown);
      if (ollamaResult && ollamaResult.suggestion) {
        suggestionText = ollamaResult.suggestion;
      }
    } catch (e) {
      // Fallback
    }

    if (!suggestionText) {
      suggestionText = `Mock strategy "${strategy}" has ${(winRate * 100).toFixed(0)}% win rate (avg PnL: $${avgPnl.toFixed(2)}). ${needsQuarantine ? 'Disable and replace.' : 'Adjust entry filters or reduce leverage.'}`;
    }

    const suggestion = {
      strategy: `${strategy} (mock)`,
      total_signals: total,
      wins,
      losses: total - wins,
      win_rate: Number(winRate.toFixed(4)),
      avg_pnl: Number((avgPnl / 100).toFixed(6)), // Normalize to decimal
      total_pnl: Number(totalPnl.toFixed(2)),
      action: needsQuarantine ? 'quarantine' : 'review',
      reason: needsQuarantine
        ? `Mock strategy "${strategy}" win rate ${(winRate * 100).toFixed(0)}% is critically low — auto-quarantined`
        : `Mock strategy "${strategy}" win rate ${(winRate * 100).toFixed(0)}% below ${(LOW_WIN_RATE_THRESHOLD * 100).toFixed(0)}% threshold — needs review`,
      suggestion: suggestionText,
      healed_at: new Date().toISOString(),
    };

    try {
      const { error: insertErr } = await supabase.from('tll_healing_log').insert(suggestion);
      if (insertErr) {
        logger.error(`[strategy-healer] Mock insert error for ${strategy}:`, insertErr.message);
      }
    } catch (e) {
      logger.error(`[strategy-healer] Mock save error for ${strategy}:`, e.message);
    }

    // If quarantining, also update strategy_scorecard throttle
    if (needsQuarantine) {
      try {
        // Update brain_strategy_weights for this strategy
        await supabase
          .from('brain_strategy_weights')
          .update({
            weight: 0.05,
            updated_at: new Date().toISOString(),
            metadata: {
              quarantined: true,
              quarantined_at: new Date().toISOString(),
              win_rate_at_quarantine: winRate,
              source: 'mock_trades_healing',
              reason: suggestion.reason,
            },
          })
          .eq('strategy', strategy);
      } catch (e) {
        logger.debug(`[strategy-healer] Mock weight update skipped for ${strategy}: ${e.message}`);
      }
    }

    healed++;
  }

  return healed;
}

/**
 * Get count of mock strategies healed (used for display).
 */
async function getMockHealedCount() {
  try {
    const { data } = await supabase
      .from('tll_healing_log')
      .select('id')
      .like('strategy', '%(mock)')
      .gte('healed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    return data?.length || 0;
  } catch {
    return 0;
  }
}
