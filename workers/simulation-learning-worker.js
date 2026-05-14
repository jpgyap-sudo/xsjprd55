// ============================================================
// Simulation Learning Worker
// Summarizes closed simulated trades into advisor_learning_memory
// Runs every SIMULATION_LEARNING_INTERVAL_MS (default 30 min)
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { logAgentEvent } from '../lib/brain-integration.js';

const INTERVAL = Number(process.env.SIMULATION_LEARNING_INTERVAL_MS || 30 * 60 * 1000); // 30 min
const WORKER_NAME = 'simulation-learning-worker';

async function runLearningCycle() {
  const results = { patternsExtracted: 0, memoriesSaved: 0, errors: [] };

  try {
    // 1. Fetch closed simulated trades (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: closedTrades, error } = await supabase
      .from('simulated_trades')
      .select('*, strategy_id, agent_id')
      .eq('status', 'closed')
      .gte('closed_at', since)
      .order('closed_at', { ascending: false })
      .limit(100);

    if (error) {
      results.errors.push(`Fetch error: ${error.message}`);
      return results;
    }

    if (!closedTrades?.length) {
      results.patternsExtracted = 0;
      return results;
    }

    // 2. Group by symbol
    const bySymbol = {};
    for (const t of closedTrades) {
      const sym = t.symbol || 'UNKNOWN';
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push(t);
    }

    // 3. Extract patterns per symbol
    for (const [symbol, trades] of Object.entries(bySymbol)) {
      const wins = trades.filter(t => (t.pnl_pct || 0) > 0);
      const losses = trades.filter(t => (t.pnl_pct || 0) <= 0);
      const totalPnl = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
      const avgPnl = trades.length ? totalPnl / trades.length : 0;
      const winRate = trades.length ? wins.length / trades.length : 0;

      // Pattern: winning conditions
      if (wins.length >= 2) {
        const avgWinPnl = wins.reduce((s, t) => s + (t.pnl_pct || 0), 0) / wins.length;
        const content = `${symbol}: ${wins.length}/${trades.length} wins (${(winRate * 100).toFixed(0)}%) in last 24h. Avg win: ${(avgWinPnl * 100).toFixed(1)}%.`;
        const { error: memErr } = await supabase.from('advisor_learning_memory').insert({
          memory_type: 'success',
          symbol,
          timeframe: trades[0]?.timeframe || 'unknown',
          content,
          confidence: Math.min(winRate + 0.1, 0.95),
          evidence: {
            trade_count: trades.length,
            win_count: wins.length,
            loss_count: losses.length,
            avg_pnl_pct: avgPnl,
            win_rate: winRate,
            sample_trade_ids: trades.slice(0, 5).map(t => t.id)
          }
        });
        if (memErr) results.errors.push(`Memory save error (${symbol}): ${memErr.message}`);
        else results.memoriesSaved++;
        results.patternsExtracted++;
      }

      // Pattern: losing conditions
      if (losses.length >= 2) {
        const avgLossPnl = losses.reduce((s, t) => s + (t.pnl_pct || 0), 0) / losses.length;
        const content = `${symbol}: ${losses.length}/${trades.length} losses (${((1 - winRate) * 100).toFixed(0)}%) in last 24h. Avg loss: ${(avgLossPnl * 100).toFixed(1)}%. Consider avoiding.`;
        const { error: memErr } = await supabase.from('advisor_learning_memory').insert({
          memory_type: 'failure',
          symbol,
          timeframe: trades[0]?.timeframe || 'unknown',
          content,
          confidence: Math.min((1 - winRate) + 0.1, 0.95),
          evidence: {
            trade_count: trades.length,
            win_count: wins.length,
            loss_count: losses.length,
            avg_pnl_pct: avgPnl,
            win_rate: winRate,
            sample_trade_ids: trades.slice(0, 5).map(t => t.id)
          }
        });
        if (memErr) results.errors.push(`Memory save error (${symbol}): ${memErr.message}`);
        else results.memoriesSaved++;
        results.patternsExtracted++;
      }
    }

    // 4. Log event
    await logAgentEvent(WORKER_NAME, 'learning_cycle', {
      trades_analyzed: closedTrades.length,
      patterns_extracted: results.patternsExtracted,
      memories_saved: results.memoriesSaved,
      symbols_covered: Object.keys(bySymbol).length
    });

  } catch (err) {
    results.errors.push(`Cycle error: ${err.message}`);
    console.error(`[${WORKER_NAME}] cycle error:`, err);
  }

  return results;
}

async function main() {
  console.log(`[${WORKER_NAME}] started, interval=${INTERVAL}ms`);

  // Run immediately on start
  const initial = await runLearningCycle();
  console.log(`[${WORKER_NAME}] initial cycle:`, JSON.stringify(initial));

  // Then run on interval
  setInterval(async () => {
    const result = await runLearningCycle();
    console.log(`[${WORKER_NAME}] cycle:`, JSON.stringify(result));
  }, INTERVAL);
}

// Allow running as standalone or imported
if (process.argv[1]?.includes('simulation-learning-worker')) {
  main().catch(err => {
    console.error(`[${WORKER_NAME}] fatal:`, err);
    process.exit(1);
  });
}

export { runLearningCycle, main };
