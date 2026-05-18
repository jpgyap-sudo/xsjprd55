// ============================================================
// Trading Learning Layer (TLL) — Main Orchestrator
// Inspired by SuperRoo's neural coding + autonomous improvement
//
// Pipeline:
//   ingestAllBridges → recordOutcome → discoverPatterns →
//   detectRegime → tuneWeights → generateSkills → healStrategies
//
// Data Sources (bridges):
//   - Mock Trading (mock-trading-bridge.js)
//   - Perpetual Trader (perpetual-trader-bridge.js)
//   - Research Agent (research-agent-bridge.js)
//   - Signal Agent (signal-agent-bridge.js)
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
import { runStrategyTournament } from './strategy-tournament.js';

// ── Data Source Bridges ────────────────────────────────────
import { ingestPerpetualTradeOutcomes, getPerpetualStrategyPerformance } from './perpetual-trader-bridge.js';
import { ingestBacktestResults, ingestStrategyProposals, syncStrategyFeedbackToHealing } from './research-agent-bridge.js';
import { ingestSignalMemory, ingestSignalPatterns, syncStrategyPerformanceToHealing } from './signal-agent-bridge.js';

const TLL_ENABLED = process.env.TLL_ENABLED !== 'false';

/**
 * Run the full TLL pipeline.
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - Skip freshness checks
 * @param {boolean} [opts.skipBridges] - Skip data source ingestion
 * @returns {Promise<Object>}
 */
export async function runLearningLayer(opts = {}) {
  if (!TLL_ENABLED) {
    logger.info('[tll] Disabled via TLL_ENABLED=false');
    return { status: 'disabled' };
  }

  const start = Date.now();
  const results = {
    // Bridge ingestion results
    perpetualIngested: 0,
    backtestIngested: 0,
    proposalsIngested: 0,
    signalMemoryIngested: 0,
    signalPatternsIngested: 0,
    feedbackSynced: 0,
    perfSynced: 0,
    // Core TLL results
    outcomesRecorded: 0,
    patternsDiscovered: 0,
    tournamentMatches: 0,
    tournamentRankings: [],
    regime: null,
    weightsTuned: 0,
    skillsGenerated: 0,
    strategiesHealed: 0,
    errors: [],
    durationMs: 0,
  };

  logger.info('[tll] === Trading Learning Layer run start ===');

  // ── STEP 0: Ingest all data sources into brain_signal_memory ──
  // This enriches the TLL with data from all 4 agents before pattern discovery.
  // Each bridge is non-blocking — failures are logged but don't stop the pipeline.
  if (!opts.skipBridges) {
    logger.info('[tll] Ingesting data from all bridges...');

    // 0a. Perpetual Trader Bridge
    try {
      const perp = await ingestPerpetualTradeOutcomes(24);
      results.perpetualIngested = perp.ingested;
      if (perp.errors.length > 0) {
        results.errors.push(`perp_bridge: ${perp.errors.join('; ')}`);
      }
      logger.info(`[tll] Perpetual trader bridge: ${perp.ingested} ingested, ${perp.skipped} skipped`);
    } catch (e) {
      results.errors.push(`perp_bridge: ${e.message}`);
      logger.error('[tll] Perpetual trader bridge failed:', e.message);
    }

    // 0b. Research Agent Bridge — Backtest Results
    try {
      const bt = await ingestBacktestResults(168);
      results.backtestIngested = bt.ingested;
      if (bt.errors.length > 0) {
        results.errors.push(`backtest_bridge: ${bt.errors.join('; ')}`);
      }
      logger.info(`[tll] Backtest bridge: ${bt.ingested} ingested, ${bt.skipped} skipped`);
    } catch (e) {
      results.errors.push(`backtest_bridge: ${e.message}`);
      logger.error('[tll] Backtest bridge failed:', e.message);
    }

    // 0c. Research Agent Bridge — Strategy Proposals
    try {
      const prop = await ingestStrategyProposals(336);
      results.proposalsIngested = prop.ingested;
      if (prop.errors.length > 0) {
        results.errors.push(`proposal_bridge: ${prop.errors.join('; ')}`);
      }
      logger.info(`[tll] Proposal bridge: ${prop.ingested} ingested, ${prop.skipped} skipped`);
    } catch (e) {
      results.errors.push(`proposal_bridge: ${e.message}`);
      logger.error('[tll] Proposal bridge failed:', e.message);
    }

    // 0d. Signal Agent Bridge — Signal Memory
    try {
      const mem = await ingestSignalMemory(48);
      results.signalMemoryIngested = mem.ingested;
      if (mem.errors.length > 0) {
        results.errors.push(`signal_memory_bridge: ${mem.errors.join('; ')}`);
      }
      logger.info(`[tll] Signal memory bridge: ${mem.ingested} ingested, ${mem.skipped} skipped`);
    } catch (e) {
      results.errors.push(`signal_memory_bridge: ${e.message}`);
      logger.error('[tll] Signal memory bridge failed:', e.message);
    }

    // 0e. Signal Agent Bridge — Signal Patterns
    try {
      const pat = await ingestSignalPatterns(72);
      results.signalPatternsIngested = pat.ingested;
      if (pat.errors.length > 0) {
        results.errors.push(`signal_pattern_bridge: ${pat.errors.join('; ')}`);
      }
      logger.info(`[tll] Signal pattern bridge: ${pat.ingested} ingested, ${pat.skipped} skipped`);
    } catch (e) {
      results.errors.push(`signal_pattern_bridge: ${e.message}`);
      logger.error('[tll] Signal pattern bridge failed:', e.message);
    }

    // 0f. Sync strategy feedback to healing (Research Agent)
    try {
      const fb = await syncStrategyFeedbackToHealing();
      results.feedbackSynced = fb.synced;
      if (fb.errors.length > 0) {
        results.errors.push(`feedback_sync: ${fb.errors.join('; ')}`);
      }
      logger.info(`[tll] Feedback sync: ${fb.synced} synced`);
    } catch (e) {
      results.errors.push(`feedback_sync: ${e.message}`);
      logger.error('[tll] Feedback sync failed:', e.message);
    }

    // 0g. Sync strategy performance to healing (Signal Agent)
    try {
      const perf = await syncStrategyPerformanceToHealing();
      results.perfSynced = perf.synced;
      if (perf.errors.length > 0) {
        results.errors.push(`perf_sync: ${perf.errors.join('; ')}`);
      }
      logger.info(`[tll] Performance sync: ${perf.synced} synced`);
    } catch (e) {
      results.errors.push(`perf_sync: ${e.message}`);
      logger.error('[tll] Performance sync failed:', e.message);
    }
  }

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

  // 2b. Run strategy tournament (head-to-head comparison)
  try {
    const tournament = await runStrategyTournament();
    results.tournamentMatches = tournament.matches?.length || 0;
    results.tournamentRankings = tournament.rankings || [];
    logger.info(`[tll] Strategy tournament: ${results.tournamentMatches} matches, ${results.tournamentRankings.length} ranked`);
  } catch (e) {
    results.errors.push(`tournament: ${e.message}`);
    logger.error('[tll] Strategy tournament failed:', e.message);
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
      bridges: {
        perpetual: results.perpetualIngested,
        backtest: results.backtestIngested,
        proposals: results.proposalsIngested,
        signal_memory: results.signalMemoryIngested,
        signal_patterns: results.signalPatternsIngested,
        feedback_synced: results.feedbackSynced,
        perf_synced: results.perfSynced,
      },
      outcomes: results.outcomesRecorded,
      patterns: results.patternsDiscovered,
      tournament: {
        matches: results.tournamentMatches,
        top_rank: results.tournamentRankings[0]?.name,
        top_elo: results.tournamentRankings[0]?.elo_score,
      },
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
  runStrategyTournament,
  // Bridge exports for external use
  ingestPerpetualTradeOutcomes,
  ingestBacktestResults,
  ingestStrategyProposals,
  ingestSignalMemory,
  ingestSignalPatterns,
  syncStrategyFeedbackToHealing,
  syncStrategyPerformanceToHealing,
};
