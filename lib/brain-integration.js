// ============================================================
// Brain Integration — Lightweight bridge between existing agents
// and the Trading Central Brain + Trading Learning Layer (TLL).
//
// Existing agents can import this module to:
// - Enrich signals with brain scores
// - Run risk gates on trades
// - Feed learning data to the brain
// - Run the TLL pipeline for adaptive learning
// ============================================================

import { runTradingBrain } from './brain/brain-router.js';
import { runLearningCycle } from './brain/learning-engine.js';
import { logBrainEvent } from './brain/brain-telemetry.js';
import { runLearningLayer } from './learning-layer/index.js';

/**
 * Enrich a signal with brain scoring.
 * Returns the original signal with added brain_* fields.
 * Gracefully handles brain failures (returns original signal).
 */
export async function enrichSignalWithBrain(signal) {
  if (!signal?.symbol) return signal;

  try {
    const decision = await runTradingBrain({
      symbol: signal.symbol,
      timeframe: signal.timeframe || '15m',
      mode: process.env.TRADING_MODE || 'paper'
    });

    return {
      ...signal,
      brain_confidence: decision.confidence,
      brain_side: decision.side,
      brain_risk_verdict: decision.risk_verdict,
      brain_explanation: decision.explanation,
      brain_score_breakdown: decision.score?.breakdown,
      brain_risk_gates: decision.risk_gates,
      brain_generated_at: decision.generated_at
    };
  } catch (err) {
    console.error('[brain-integration] enrichSignalWithBrain error:', err.message);
    return signal;
  }
}

/**
 * Run brain risk gates on a potential trade.
 * Returns { approved, gates, verdict }.
 */
export async function brainRiskCheck({ symbol, timeframe, side, mode }) {
  try {
    const decision = await runTradingBrain({ symbol, timeframe, mode });
    return {
      approved: decision.risk_verdict === 'APPROVED',
      confidence: decision.confidence,
      side: decision.side,
      gates: decision.risk_gates,
      verdict: decision.risk_verdict,
      explanation: decision.explanation
    };
  } catch (err) {
    console.error('[brain-integration] brainRiskCheck error:', err.message);
    return { approved: true, confidence: 0.5, side, gates: [], verdict: 'FALLBACK', explanation: 'Brain unavailable' };
  }
}

/**
 * Run the brain learning cycle alongside the existing learning loop.
 * Returns { brain_cycle_result, existing_loop_result }.
 */
export async function runIntegratedLearning(existingLoopResult) {
  let brainResult = { ok: false, message: 'Not run' };

  try {
    brainResult = await runLearningCycle();
    await logBrainEvent('integrated_learning', {
      existing_outcomes: existingLoopResult?.outcomesResolved || 0,
      brain_reports: brainResult?.reports?.length || 0
    });
  } catch (err) {
    console.error('[brain-integration] runIntegratedLearning error:', err.message);
    brainResult = { ok: false, error: err.message };
  }

  return {
    existing_loop: existingLoopResult,
    brain_cycle: brainResult,
    timestamp: new Date().toISOString()
  };
}

/**
 * Log a brain event from any agent.
 */
export async function logAgentEvent(agent, event, payload = {}) {
  return logBrainEvent(`${agent}_${event}`, {
    agent,
    ...payload,
    timestamp: new Date().toISOString()
  });
}

/**
 * Run the Trading Learning Layer (TLL) pipeline.
 * Integrates with the existing learning loop for adaptive improvement.
 * Returns { tll_result, brain_cycle_result }.
 */
export async function runIntegratedTLL(existingLoopResult) {
  let tllResult = { status: 'not_run' };
  let brainResult = { ok: false, message: 'Not run' };

  try {
    // Run TLL first (outcome recording, pattern discovery, regime detection)
    tllResult = await runLearningLayer({ force: false });
    await logBrainEvent('integrated_tll', {
      outcomes: tllResult.outcomesRecorded,
      patterns: tllResult.patternsDiscovered,
      regime: tllResult.regime?.regime,
      weights: tllResult.weightsTuned,
      skills: tllResult.skillsGenerated,
      healed: tllResult.strategiesHealed,
      existing_outcomes: existingLoopResult?.outcomesResolved || 0,
    });
  } catch (err) {
    console.error('[brain-integration] runIntegratedTLL error:', err.message);
    tllResult = { status: 'error', error: err.message };
  }

  // Then run the existing brain learning cycle
  try {
    brainResult = await runLearningCycle();
    await logBrainEvent('integrated_learning', {
      existing_outcomes: existingLoopResult?.outcomesResolved || 0,
      brain_reports: brainResult?.reports?.length || 0,
      tll_regime: tllResult?.regime?.regime,
    });
  } catch (err) {
    console.error('[brain-integration] runIntegratedLearning error:', err.message);
    brainResult = { ok: false, error: err.message };
  }

  return {
    existing_loop: existingLoopResult,
    tll: tllResult,
    brain_cycle: brainResult,
    timestamp: new Date().toISOString()
  };
}
