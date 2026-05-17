// ============================================================
// Mock Trading → TLL Bridge
// Connects the mock trading system to the Trading Learning Layer.
//
// Provides:
//   1. Mock trade outcome ingestion into TLL pattern discovery
//   2. TLL regime → mock trading regime adapter
//   3. TLL skills → mock trading signal filters
//   4. TLL weights → mock trading strategy selection
//   5. TLL healing → mock trading throttle integration
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

// ── 1. Mock Trade Outcome Ingestion ─────────────────────────

/**
 * Record a closed mock trade outcome into brain_signal_memory
 * so TLL pattern discovery can analyze it alongside brain signals.
 *
 * @param {Object} trade - Closed mock trade row
 * @param {Object} [opts]
 * @param {string} [opts.source] - 'mock_account_engine' | 'aggressive_engine' | 'execution_engine'
 * @returns {Promise<boolean>}
 */
export async function recordMockTradeOutcome(trade, opts = {}) {
  if (!trade || trade.status !== 'closed') return false;

  const pnlPct = Number(trade.pnl_pct || 0);
  const outcome = pnlPct > 0 ? 'win' : pnlPct < 0 ? 'loss' : 'breakeven';

  // Build a brain_signal_memory-compatible record
  const signalRecord = {
    symbol: trade.symbol,
    side: (trade.side || '').toUpperCase(),
    entry_price: Number(trade.entry_price),
    strategy: trade.strategy_name || trade.strategy || 'unknown',
    timeframe: trade.timeframe || '15m',
    confidence: Number(trade.probability_at_entry || 0.5),
    mode: 'paper',
    source: opts.source || 'mock_trading',
    generated_at: trade.created_at || new Date().toISOString(),
    resolved_at: trade.closed_at || new Date().toISOString(),
    resolved_pnl: pnlPct / 100, // Normalize to decimal
    metadata: {
      mock_trade_id: trade.id,
      mock_source: opts.source || 'mock_trading',
      exit_reason: trade.exit_reason,
      leverage: trade.leverage,
      pnl_usd: trade.pnl_usd,
      position_size_usd: trade.position_size_usd,
      outcome,
      resolution: 'mock_trade_outcome',
      current_price_at_resolution: trade.exit_price,
    },
  };

  try {
    const { error } = await supabase.from('brain_signal_memory').insert(signalRecord);
    if (error) {
      logger.warn(`[mock-trading-bridge] Insert outcome failed for trade ${trade.id}: ${error.message}`);
      return false;
    }
    logger.debug(`[mock-trading-bridge] Recorded mock trade ${trade.id} outcome (${outcome}, pnl=${pnlPct})`);
    return true;
  } catch (e) {
    logger.warn(`[mock-trading-bridge] Outcome recording error for trade ${trade.id}: ${e.message}`);
    return false;
  }
}

/**
 * Batch-record all recently closed mock trades that haven't been
 * ingested into TLL yet. Uses a dedup check against brain_signal_memory.
 *
 * @param {number} [hours=24] - Lookback window
 * @returns {Promise<number>} Number of outcomes recorded
 */
export async function ingestRecentMockTradeOutcomes(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Fetch closed mock trades from the last N hours
  const { data: closedTrades, error } = await supabase
    .from('mock_trades')
    .select('*')
    .eq('status', 'closed')
    .gte('closed_at', since)
    .order('closed_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error('[mock-trading-bridge] Fetch closed trades error:', error.message);
    return 0;
  }

  if (!closedTrades?.length) return 0;

  // Dedup: check which trade IDs already exist in brain_signal_memory
  const existingMockIds = new Set();
  try {
    const { data: existing } = await supabase
      .from('brain_signal_memory')
      .select("metadata->>mock_trade_id")
      .not('metadata->>mock_trade_id', 'is', null)
      .gte('resolved_at', since);
    for (const row of existing || []) {
      if (row.mock_trade_id) existingMockIds.add(String(row.mock_trade_id));
    }
  } catch (e) {
    logger.warn('[mock-trading-bridge] Dedup check failed, will attempt all:', e.message);
  }

  let recorded = 0;
  for (const trade of closedTrades) {
    if (existingMockIds.has(String(trade.id))) continue;
    const ok = await recordMockTradeOutcome(trade, { source: 'mock_trading_batch' });
    if (ok) recorded++;
  }

  logger.info(`[mock-trading-bridge] Ingested ${recorded}/${closedTrades.length} mock trade outcomes`);
  return recorded;
}

// ── 2. TLL Regime → Mock Trading Regime Adapter ─────────────

/**
 * Map TLL regime labels to mock trading regime labels.
 * TLL uses: trending, choppy, ranging, quiet, mixed
 * Mock trading uses: trending, ranging, high_volatility, news_risk
 */
const TLL_TO_MOCK_REGIME = {
  trending: 'trending',
  choppy: 'high_volatility',
  ranging: 'ranging',
  quiet: 'ranging',
  mixed: 'ranging',
  unknown: 'unknown',
};

/**
 * Get the latest TLL regime, adapted for mock trading consumption.
 * @returns {Promise<Object>} { regime, adjustment, details }
 */
export async function getTllRegimeForMockTrading() {
  try {
    const { data } = await supabase
      .from('tll_regime_log')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      return { regime: 'unknown', adjustment: null, details: null };
    }

    const mockRegime = TLL_TO_MOCK_REGIME[data.regime] || 'unknown';

    // Build adjustment object matching mock trading's getRegimeAdjustment format
    const adjustment = getMockRegimeAdjustment(mockRegime);

    return {
      regime: mockRegime,
      tllRegime: data.regime,
      adjustment,
      details: {
        volatility: data.volatility,
        win_rate: data.win_rate,
        detected_at: data.detected_at,
      },
    };
  } catch (e) {
    logger.warn('[mock-trading-bridge] getTllRegimeForMockTrading error:', e.message);
    return { regime: 'unknown', adjustment: null, details: null };
  }
}

/**
 * Get regime adjustment matching mock trading's format.
 */
function getMockRegimeAdjustment(regime) {
  switch (regime) {
    case 'high_volatility':
      return { sizeMultiplier: 0.5, slMultiplier: 1.5, confidenceBonus: -0.03 };
    case 'news_risk':
      return { sizeMultiplier: 0.3, slMultiplier: 2.0, confidenceBonus: -0.05 };
    case 'trending':
      return { sizeMultiplier: 1.0, slMultiplier: 1.0, confidenceBonus: 0.02 };
    case 'ranging':
      return { sizeMultiplier: 0.8, slMultiplier: 1.0, confidenceBonus: 0 };
    default:
      return { sizeMultiplier: 1.0, slMultiplier: 1.0, confidenceBonus: 0 };
  }
}

// ── 3. TLL Skills → Mock Trading Signal Filters ─────────────

/**
 * Get active TLL skills that can be used as signal filters.
 * @param {number} [minConfidence=0.6] - Minimum confidence threshold
 * @returns {Promise<Array>} Array of skill objects
 */
export async function getActiveTllSkills(minConfidence = 0.6) {
  try {
    const { data, error } = await supabase
      .from('tll_skills')
      .select('*')
      .gte('confidence', minConfidence)
      .order('confidence', { ascending: false })
      .limit(20);

    if (error) {
      logger.warn('[mock-trading-bridge] getActiveTllSkills error:', error.message);
      return [];
    }

    return data || [];
  } catch (e) {
    logger.warn('[mock-trading-bridge] getActiveTllSkills error:', e.message);
    return [];
  }
}

/**
 * Check if a signal is supported by active TLL skills.
 * Returns a confidence boost or penalty based on skill alignment.
 *
 * @param {Object} signal - Signal to check
 * @param {Array} skills - Active TLL skills (from getActiveTllSkills)
 * @returns {Object} { boost: number, supportingSkills: string[], conflictingSkills: string[] }
 */
export function checkSignalAgainstTllSkills(signal, skills = []) {
  const result = { boost: 0, supportingSkills: [], conflictingSkills: [] };

  if (!skills.length) return result;

  const side = (signal.side || '').toUpperCase();
  const symbol = signal.symbol || '';
  const strategy = signal.strategy || '';

  for (const skill of skills) {
    const meta = skill.metadata || {};
    const description = (skill.description || '').toLowerCase();

    // Check if skill mentions this symbol or side
    const matchesSymbol = description.includes(symbol.toLowerCase());
    const matchesSide = description.includes(side.toLowerCase());
    const matchesStrategy = description.includes((strategy || '').toLowerCase());

    if (matchesSymbol || matchesSide || matchesStrategy) {
      // Determine if skill is favorable or unfavorable
      const isFavorable = !description.includes('avoid') && !description.includes('unfavorable');
      if (isFavorable) {
        result.boost += skill.confidence * 0.05; // Up to 5% boost per skill
        result.supportingSkills.push(skill.name || skill.description);
      } else {
        result.boost -= skill.confidence * 0.05;
        result.conflictingSkills.push(skill.name || skill.description);
      }
    }
  }

  // Clamp boost to +/- 15%
  result.boost = Math.max(-0.15, Math.min(0.15, result.boost));

  return result;
}

// ── 4. TLL Weights → Mock Trading Strategy Selection ────────

/**
 * Get TLL strategy weights for mock trading strategy selection.
 * @returns {Promise<Object>} Map of strategy → weight
 */
export async function getTllStrategyWeights() {
  try {
    const { data, error } = await supabase
      .from('brain_strategy_weights')
      .select('strategy, weight, metadata')
      .order('weight', { ascending: false });

    if (error) {
      logger.warn('[mock-trading-bridge] getTllStrategyWeights error:', error.message);
      return {};
    }

    const weights = {};
    for (const row of data || []) {
      // Skip quarantined strategies
      if (row.metadata?.quarantined) {
        weights[row.strategy] = 0;
      } else {
        weights[row.strategy] = row.weight;
      }
    }

    return weights;
  } catch (e) {
    logger.warn('[mock-trading-bridge] getTllStrategyWeights error:', e.message);
    return {};
  }
}

/**
 * Check if a strategy is quarantined by TLL.
 * @param {string} strategyName
 * @returns {Promise<boolean>}
 */
export async function isStrategyQuarantined(strategyName) {
  try {
    const { data } = await supabase
      .from('brain_strategy_weights')
      .select('metadata')
      .eq('strategy', strategyName)
      .maybeSingle();

    return data?.metadata?.quarantined === true;
  } catch (e) {
    return false;
  }
}

// ── 5. TLL Healing → Mock Trading Throttle Integration ──────

/**
 * Get TLL healing records that apply to mock trading strategies.
 * @param {number} [hours=72] - Lookback window
 * @returns {Promise<Array>} Healing records
 */
export async function getTllHealingForMockTrading(hours = 72) {
  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('tll_healing_log')
      .select('*')
      .gte('healed_at', since)
      .order('healed_at', { ascending: false });

    if (error) {
      logger.warn('[mock-trading-bridge] getTllHealingForMockTrading error:', error.message);
      return [];
    }

    return data || [];
  } catch (e) {
    logger.warn('[mock-trading-bridge] getTllHealingForMockTrading error:', e.message);
    return [];
  }
}

// ── 6. Unified TLL Dashboard Data ───────────────────────────

/**
 * Get a unified snapshot of TLL data relevant to mock trading.
 * Used by the dashboard API.
 * @returns {Promise<Object>}
 */
export async function getTllMockTradingSnapshot() {
  const [regime, skills, weights, healing, patterns] = await Promise.all([
    getTllRegimeForMockTrading(),
    getActiveTllSkills(0.5),
    getTllStrategyWeights(),
    getTllHealingForMockTrading(168), // 7 days
    (async () => {
      try {
        const { data } = await supabase
          .from('tll_patterns')
          .select('*')
          .order('confidence', { ascending: false })
          .limit(20);
        return data || [];
      } catch { return []; }
    })(),
  ]);

  return {
    regime,
    activeSkills: skills.length,
    topSkills: skills.slice(0, 5),
    strategyWeights: weights,
    recentHealing: healing.slice(0, 10),
    topPatterns: patterns,
  };
}
