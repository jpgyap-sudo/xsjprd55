// ============================================================
// Brain Router — Main orchestrator for the Trading Central Brain.
// Flow: buildSignalContext → scoreStrategy → runRiskGate →
//       explainDecision → saveSignalMemory
// ============================================================

import { buildSignalContext } from './signal-context-builder.js';
import { scoreStrategy } from './strategy-scorer.js';
import { runRiskGate } from './risk-gate.js';
import { explainDecision } from './model-router.js';
import { saveSignalMemory } from './market-memory.js';
import { logBrainEvent } from './brain-telemetry.js';

/**
 * Run the full trading brain pipeline for a symbol+timeframe.
 *
 * @param {Object} input
 * @param {string} input.symbol - Trading pair (e.g. "BTCUSDT")
 * @param {string} input.timeframe - Timeframe (e.g. "15m", "1h")
 * @param {string} [input.mode] - "paper" (default) or "live"
 * @returns {Promise<Object>} decision object
 */
export async function runTradingBrain(input = {}) {
  const { symbol = 'BTCUSDT', timeframe = '15m', mode = 'paper' } = input;

  console.log(`[brain-router] Running brain for ${symbol} ${timeframe} (${mode})`);

  // Step 1: Build signal context (market + liquidation + news)
  const context = await buildSignalContext({ symbol, timeframe, mode });

  // Step 2: Score the strategy
  const strategy = await scoreStrategy(context);

  // Step 3: Run risk gates
  const risk = await runRiskGate({ context, strategy, mode });

  // Step 4: Explain the decision
  const explanation = await explainDecision({ context, strategy, risk });

  // Step 5: Assemble decision
  const decision = {
    symbol,
    timeframe,
    mode,
    side: strategy.side,
    entry_price: context?.market?.data?.close || null,
    confidence: strategy.composite,
    strategy: 'brain_central',
    score: strategy,
    risk_verdict: risk.verdict,
    risk_gates: risk.gates,
    explanation: explanation.explanation,
    explanation_provider: explanation.provider,
    context_summary: {
      market_ok: context.market?.ok ?? false,
      liquidation_bias: context.liquidation?.bias ?? 0,
      news_sentiment: context.news?.sentiment ?? 0,
      market_age_seconds: context.freshness.market_age_seconds
    },
    generated_at: new Date().toISOString()
  };

  // Step 6: Save to signal memory (only if risk gates pass)
  if (risk.passed) {
    const saved = await saveSignalMemory(decision);
    if (!saved.ok) {
      console.error('[brain-router] Failed to save signal memory:', saved.error);
    }
  }

  // Step 7: Log telemetry
  await logBrainEvent('brain_decision', {
    symbol,
    timeframe,
    side: strategy.side,
    confidence: strategy.composite,
    risk_verdict: risk.verdict,
    mode
  });

  return decision;
}
