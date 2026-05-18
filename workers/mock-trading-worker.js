// ============================================================
// Mock Trading Worker v3 — TLL-Integrated
// Opens paper trades for high-probability signals AND consumes
// promoted strategies from the Research Agent's strategy_lifecycle.
// Now integrates with Trading Learning Layer (TLL) for:
//   - Regime-aware trading
//   - Skill-based signal filtering
//   - Strategy weight awareness
//   - Quarantine respect
// Runs every 3 minutes on VPS.
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { getOrCreateMockAccount, openMockTrade, closeMockTrade } from '../lib/mock-trading/mock-account-engine.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';
import { fetchPublicPrice } from '../lib/market-price.js';
import { isMainModule } from '../lib/entrypoint.js';
import { brainRiskCheck, logAgentEvent } from '../lib/brain-integration.js';
import { recordWorkerHeartbeat } from '../lib/worker-health.js';

// TLL imports
import {
  getTllRegimeForMockTrading,
  getActiveTllSkills,
  getTllStrategyWeights,
  isStrategyQuarantined,
  checkSignalAgainstTllSkills,
} from '../lib/learning-layer/mock-trading-bridge.js';

const INTERVAL_MS = 3 * 60 * 1000;

// Track which promoted strategies we've already processed to avoid duplicates
const PROCESSED_PROMOTED_STRATEGIES = new Set();

export async function runMockTradingWorker() {
  const started = Date.now();
  if (!config.ENABLE_MOCK_TRADING_WORKER) {
    logger.debug('[MOCK-WORKER] Disabled by config');
    await recordWorkerHeartbeat('mock-trading-worker', {
      status: 'warning',
      durationMs: Date.now() - started,
      details: { disabled: true },
    });
    return;
  }

  if (isSupabaseNoOp()) {
    logger.error('[MOCK-WORKER] Supabase is in NO-OP mode. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
    await recordWorkerHeartbeat('mock-trading-worker', {
      status: 'error',
      durationMs: Date.now() - started,
      error: 'Supabase NO-OP',
    });
    return;
  }

  logger.info('[MOCK-WORKER] Tick');

  // ── Cache TLL data once per tick ──────────────────────────
  let tllRegime = null;
  let tllSkills = [];
  let tllWeights = {};
  try {
    const [regime, skills, weights] = await Promise.all([
      getTllRegimeForMockTrading(),
      getActiveTllSkills(0.6),
      getTllStrategyWeights(),
    ]);
    tllRegime = regime;
    tllSkills = skills;
    tllWeights = weights;
    if (regime.regime !== 'unknown') {
      logger.debug(`[MOCK-WORKER] TLL regime: ${regime.regime} (${regime.tllRegime})`);
    }
  } catch (e) {
    logger.debug('[MOCK-WORKER] TLL cache failed:', e.message);
  }

  try {
    // 1. Open new mock trades for recent high-probability signals
    // Fallback: if signal_feature_scores is empty, read signals directly
    let scoredSignals = [];
    try {
      const { data: recentScores } = await supabase
        .from('signal_feature_scores')
        .select('*, signal:signal_id(*)')
        .gte('final_probability', 65)
        .order('created_at', { ascending: false })
        .limit(20);
      scoredSignals = recentScores || [];
    } catch (e) {
      logger.debug('[MOCK-WORKER] signal_feature_scores query failed, falling back to signals table');
    }

    // Fallback: read valid active signals directly if no feature scores
    if (scoredSignals.length === 0) {
      try {
        const now = new Date().toISOString();
        const isPaper = (process.env.TRADING_MODE || 'paper') === 'paper';
        let query = supabase
          .from('signals')
          .select('*')
          .eq('status', 'active')
          .order('generated_at', { ascending: false })
          .limit(20);
        // In paper mode be permissive; live mode only non-expired
        if (!isPaper) query = query.gt('valid_until', now);
        const { data: recentSignals } = await query;
        scoredSignals = (recentSignals || []).map(s => ({
          signal: s,
          final_probability: Math.round((s.confidence || 0.5) * 100)
        }));
      } catch (e) {
        logger.warn('[MOCK-WORKER] Fallback signal read failed:', e.message);
      }
    }

    for (const score of scoredSignals) {
      const signal = score.signal;
      if (!signal) continue;

      const normalizedSide = (signal.side || '').toLowerCase();

      // Run Central Brain risk gate before opening trade
      try {
        const riskCheck = await brainRiskCheck({
          symbol: signal.symbol,
          timeframe: signal.timeframe || '15m',
          side: normalizedSide,
          mode: process.env.TRADING_MODE || 'paper'
        });

        if (!riskCheck.approved) {
          logger.info(`[MOCK-WORKER] Brain blocked ${signal.symbol} ${normalizedSide}: ${riskCheck.verdict}`);
          await logAgentEvent('mock_trading', 'brain_blocked_trade', {
            symbol: signal.symbol,
            side: normalizedSide,
            verdict: riskCheck.verdict,
            confidence: riskCheck.confidence
          });
          continue;
        }

        // Log brain approval
        await logAgentEvent('mock_trading', 'brain_approved_trade', {
          symbol: signal.symbol,
          side: normalizedSide,
          brain_confidence: riskCheck.confidence,
          brain_verdict: riskCheck.verdict
        });
      } catch (brainErr) {
        logger.warn(`[MOCK-WORKER] Brain risk check failed for ${signal.symbol}: ${brainErr.message}`);
        // Fall through — allow trade if brain is unavailable
      }

      // ── TLL Regime Check ──────────────────────────────────
      if (tllRegime && tllRegime.regime === 'high_volatility') {
        logger.debug(`[MOCK-WORKER] TLL blocked ${signal.symbol}: high_volatility regime`);
        await logAgentEvent('mock_trading', 'tll_blocked_trade', {
          symbol: signal.symbol,
          side: normalizedSide,
          reason: 'high_volatility_regime',
          regime: tllRegime.regime,
        });
        continue;
      }

      // ── TLL Skill Check ───────────────────────────────────
      if (tllSkills.length > 0) {
        const skillCheck = checkSignalAgainstTllSkills(
          { side: normalizedSide, symbol: signal.symbol, strategy: signal.strategy },
          tllSkills
        );
        if (skillCheck.conflictingSkills.length > 0 && skillCheck.boost < -0.05) {
          logger.debug(`[MOCK-WORKER] TLL skills blocked ${signal.symbol}: ${skillCheck.conflictingSkills.join(', ')}`);
          continue;
        }
      }

      // ── TLL Strategy Weight Check ─────────────────────────
      const strategyName = signal.strategy || signal.strategy_name;
      if (strategyName && tllWeights[strategyName] === 0) {
        logger.debug(`[MOCK-WORKER] TLL blocked ${signal.symbol}: strategy "${strategyName}" is quarantined`);
        continue;
      }

      // Dedup by open position for this symbol (any side)
      const { data: existing } = await supabase
        .from('mock_trades')
        .select('id')
        .eq('symbol', signal.symbol)
        .eq('status', 'open')
        .limit(1);
      if (existing?.length) continue;

      // Skip expired signals
      const now = Date.now();
      const validUntil = signal.valid_until ? new Date(signal.valid_until).getTime() : 0;
      if (validUntil && validUntil < now) continue;

      // Normalize signal — null out id when it comes from signal_logs (not signals table)
      const isFromSignalsTable = !score.signal_id;
      const normalizedSignal = {
        ...signal,
        id: isFromSignalsTable ? signal.id : null,
        side: normalizedSide,
        strategy: signal.strategy || signal.strategy_name,
        best_leverage: 2,
        stop_loss_pct: 1.2,
        take_profit_pct: 2.5
      };

      try {
        await openMockTrade(normalizedSignal, { finalProbability: score.final_probability });
      } catch (e) {
        logger.warn(`[MOCK-WORKER] openMockTrade failed for ${signal.symbol}: ${e.message}`);
      }
    }

    // 2. Monitor open mock trades for SL/TP or time exit
    const { data: openTrades } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('status', 'open');

    for (const trade of openTrades || []) {
      try {
        const { price, source } = await fetchPublicPrice(trade.symbol);
        logger.debug(`[MOCK-WORKER] ${trade.symbol} price from ${source}: ${price}`);
        const sl = Number(trade.stop_loss);
        const tp = Number(trade.take_profit);

        const hitSl = trade.side === 'long' ? price <= sl : price >= sl;
        const hitTp = trade.side === 'long' ? price >= tp : price <= tp;

        if (hitSl) await closeMockTrade(trade.id, price, 'stop_loss');
        else if (hitTp) await closeMockTrade(trade.id, price, 'take_profit');
      } catch (e) {
        logger.warn(`[MOCK-WORKER] Monitor failed for ${trade.symbol}: ${e.message}`);
      }
    }

    // Cross-agent improvement: report mock trading losses and patterns
    try {
      const { data: closed } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('status', 'closed')
        .gte('closed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (closed?.length) {
        const losses = closed.filter(t => (t.pnl || 0) < 0);
        const avgLoss = losses.length ? losses.reduce((s, t) => s + Math.abs(t.pnl || 0), 0) / losses.length : 0;
        const highLevLosses = losses.filter(t => (t.leverage || 1) > 5);

        if (losses.length >= 3 && avgLoss > 10) {
          await dedupSendIdea({
            sourceBot: 'Mock Trading Bot',
            ideaType: 'Risk Management',
            featureAffected: 'Trade Execution Logic',
            observation: `Mock bot lost $${avgLoss.toFixed(2)} avg on ${losses.length} trades in last 24h. ${highLevLosses.length} used >5x leverage.`,
            recommendation: 'Limit leverage to 2x when probability score is below 70%. Enforce tighter stop-losses during high-volatility regimes.',
            expectedBenefit: 'Lower drawdown and better account survival in choppy markets.',
            priority: 'High',
            confidence: 'Needs Testing',
            status: 'Needs Backtest',
          });
        }
      }
    } catch (e) {
      // improvement ideas are best-effort
    }

    // ── Research Agent Integration ──────────────────────────────
    // Consume promoted strategies from strategy_lifecycle and test them
    try {
      const { data: promotedStrategies } = await supabase
        .from('strategy_lifecycle')
        .select('*')
        .eq('approved_for_mock', true)
        .order('promotion_gate_score', { ascending: false })
        .limit(10);

      if (promotedStrategies?.length) {
        let tested = 0;
        for (const strat of promotedStrategies) {
          // Skip if we already processed this strategy
          const dedupKey = `${strat.strategy_name}_${strat.rules_hash || 'no_hash'}`;
          if (PROCESSED_PROMOTED_STRATEGIES.has(dedupKey)) continue;
          PROCESSED_PROMOTED_STRATEGIES.add(dedupKey);

          // Check if this strategy already has mock trades
          const { data: existingTrades } = await supabase
            .from('mock_trades')
            .select('id')
            .eq('strategy', strat.strategy_name)
            .limit(1);

          if (existingTrades?.length) {
            logger.debug(`[MOCK-WORKER] Strategy ${strat.strategy_name} already has mock trades — skipping`);
            continue;
          }

          // Fetch recent signals for this strategy to test
          const { data: strategySignals } = await supabase
            .from('signals')
            .select('*')
            .eq('strategy', strat.strategy_name)
            .eq('status', 'active')
            .order('generated_at', { ascending: false })
            .limit(5);

          if (!strategySignals?.length) {
            logger.debug(`[MOCK-WORKER] No active signals for promoted strategy ${strat.strategy_name}`);
            continue;
          }

          // Open mock trades for each signal
          for (const signal of strategySignals) {
            try {
              // Check for existing open trade on this symbol
              const { data: existing } = await supabase
                .from('mock_trades')
                .select('id')
                .eq('symbol', signal.symbol)
                .eq('status', 'open')
                .limit(1);
              if (existing?.length) continue;

              await openMockTrade({
                ...signal,
                id: signal.id,
                side: (signal.side || '').toLowerCase(),
                strategy: strat.strategy_name,
                best_leverage: 2,
                stop_loss_pct: 1.5,
                take_profit_pct: 3.0
              }, { finalProbability: Math.round((signal.confidence || 0.5) * 100) });

              tested++;
              logger.info(`[MOCK-WORKER] Opened research-agent trade for ${strat.strategy_name} on ${signal.symbol}`);
            } catch (e) {
              logger.warn(`[MOCK-WORKER] Research-agent trade failed for ${strat.strategy_name}/${signal.symbol}: ${e.message}`);
            }
          }
        }

        if (tested > 0) {
          logger.info(`[MOCK-WORKER] Research Agent Integration: tested ${tested} trades from ${promotedStrategies.length} promoted strategies`);
        }
      }
    } catch (e) {
      logger.warn(`[MOCK-WORKER] Research Agent integration failed: ${e.message}`);
    }

    // Prune processed set to prevent memory leak
    if (PROCESSED_PROMOTED_STRATEGIES.size > 1000) {
      const toKeep = Array.from(PROCESSED_PROMOTED_STRATEGIES).slice(-500);
      PROCESSED_PROMOTED_STRATEGIES.clear();
      for (const k of toKeep) PROCESSED_PROMOTED_STRATEGIES.add(k);
    }

    logger.info('[MOCK-WORKER] Tick complete');
    await recordWorkerHeartbeat('mock-trading-worker', { durationMs: Date.now() - started });
  } catch (err) {
    logger.error(`[MOCK-WORKER] ${err.message}`);
    await recordWorkerHeartbeat('mock-trading-worker', { status: 'error', durationMs: Date.now() - started, error: err.message });
    await dedupSendIdea({
      sourceBot: 'Mock Trading Bot',
      ideaType: 'Bug Fix',
      featureAffected: 'Mock Trading Worker',
      observation: `Worker crashed: ${err.message}`,
      recommendation: 'Add error boundaries and retry logic for exchange API calls in mock trading worker.',
      priority: 'High',
      confidence: 'High',
      status: 'New',
      relatedErrorId: err.message,
    });
  }
}

if (isMainModule(import.meta.url)) {
  logger.info('[MOCK-WORKER] Starting loop...');
  await runMockTradingWorker();
  setInterval(runMockTradingWorker, INTERVAL_MS);
}
