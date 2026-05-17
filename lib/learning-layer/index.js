// ============================================================
// Trading Learning Layer (TLL) — Main Orchestrator
// Inspired by SuperRoo's neural coding + autonomous improvement
//
// Pipeline:
//   recordOutcome → discoverPatterns → detectRegime →
//   tuneWeights → generateSkills → healStrategies
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

// ── Sub-modules ────────────────────────────────────────────
import { recordSignalOutcome, getRecentOutcomes } from './outcome-recorder.js';
import { discoverPatterns } from './pattern-discoverer.js';
import { detectMarketRegime } from './regime-detector.js';
import { tuneAdaptiveWeights } from './weight-tuner.js';
import { generateTradingSkills } from './skill-generator.js';
import { healStrategies } from './strategy-healer.js';

const TLL_ENABLED = process.env.TLL_ENABLED !== 'false';

/**
 * Run the full TLL pipeline.
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - Skip freshness checks
 * @returns {Promise<Object>}
 */
export async function runLearningLayer(opts = {}) {
  if (!TLL_ENABLED) {
    logger.info('[tll] Disabled via TLL_ENABLED=false');
    return { status: 'disabled' };
  }

  const start = Date.now();
  const results = {
    outcomesRecorded: 0,
    patternsDiscovered: 0,
    regime: null,
    weightsTuned: 0,
    skillsGenerated: 0,
    strategiesHealed: 0,
    errors: [],
    durationMs: 0,
  };

  logger.info('[tll] === Trading Learning Layer run start ===');

  // 1. Record pending signal outcomes
  try {
    const recorded = await recordSignalOutcome();
    results.outcomesRecorded = recorded;
    logger.info(`[tll] Outcomes recorded: ${recorded}`);
  } catch (e) {
    results.errors.push(`outcomes: ${e.message}`);
    logger.error('[tll] Outcome recording failed:', e.message);
  }

  // 2. Discover patterns from recent outcomes
  try {
    const patterns = await discoverPatterns();
    results.patternsDiscovered = patterns.length;
    logger.info(`[tll] Patterns discovered: ${patterns.length}`);
  } catch (e) {
    results.errors.push(`patterns: ${e.message}`);
    logger.error('[tll] Pattern discovery failed:', e.message);
  }

  // 3. Detect current market regime
  try {
    const regime = await detectMarketRegime();
    results.regime = regime;
    logger.info(`[tll] Market regime: ${regime?.regime || 'unknown'}`);
  } catch (e) {
    results.errors.push(`regime: ${e.message}`);
    logger.error('[tll] Regime detection failed:', e.message);
  }

  // 4. Tune adaptive weights based on regime + patterns
  try {
    const tuned = await tuneAdaptiveWeights(results.regime);
    results.weightsTuned = tuned;
    logger.info(`[tll] Weights tuned: ${tuned}`);
  } catch (e) {
    results.errors.push(`weights: ${e.message}`);
    logger.error('[tll] Weight tuning failed:', e.message);
  }

  // 5. Generate trading skills from discovered patterns
  try {
    const skills = await generateTradingSkills();
    results.skillsGenerated = skills.length;
    logger.info(`[tll] Skills generated: ${skills.length}`);
  } catch (e) {
    results.errors.push(`skills: ${e.message}`);
    logger.error('[tll] Skill generation failed:', e.message);
  }

  // 6. Heal underperforming strategies
  try {
    const healed = await healStrategies();
    results.strategiesHealed = healed;
    logger.info(`[tll] Strategies healed: ${healed}`);
  } catch (e) {
    results.errors.push(`heal: ${e.message}`);
    logger.error('[tll] Strategy healing failed:', e.message);
  }

  results.durationMs = Date.now() - start;
  logger.info(`[tll] === TLL run complete in ${results.durationMs}ms ===`);

  // Log to brain events
  try {
    const { logBrainEvent } = await import('../brain/brain-telemetry.js');
    await logBrainEvent('tll_cycle', {
      outcomes: results.outcomesRecorded,
      patterns: results.patternsDiscovered,
      regime: results.regime?.regime,
      weights: results.weightsTuned,
      skills: results.skillsGenerated,
      healed: results.strategiesHealed,
      duration_ms: results.durationMs,
      errors: results.errors.length,
    });
  } catch (_) { /* non-blocking */ }

  return results;
}

export {
  recordSignalOutcome,
  discoverPatterns,
  detectMarketRegime,
  tuneAdaptiveWeights,
  generateTradingSkills,
  healStrategies,
};
