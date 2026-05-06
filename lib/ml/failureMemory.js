// ============================================================
// Failure Memory
// Stores why strategies failed so the research agent avoids
// regenerating the same weak patterns.
// ============================================================

import crypto from 'crypto';
import { db } from './db.js';
import { logger } from '../logger.js';

/**
 * @typedef {Object} FailureRecord
 * @property {string} rules_hash — deterministic hash of strategy rules
 * @property {string} strategy_name — original strategy name
 * @property {string} failure_reason — human-readable reason
 * @property {string} failure_category — category of failure
 * @property {number} total_trades — how many trades were evaluated
 * @property {number} win_rate — win rate when failed
 * @property {number} profit_factor — profit factor when failed
 * @property {number} max_drawdown_pct — max drawdown when failed
 * @property {number} expectancy — expectancy when failed
 * @property {string} symbols_tested — comma-separated symbols
 * @property {string} failed_at — timestamp
 */

/**
 * Categories of failure for structured analysis.
 */
export const FAILURE_CATEGORIES = {
  LOW_TRADE_COUNT: 'low_trade_count',
  BAD_DRAWDOWN: 'bad_drawdown',
  SINGLE_SYMBOL_ONLY: 'single_symbol_only',
  FAILS_OOS: 'fails_out_of_sample',
  PROFITABLE_BUT_VOLATILE: 'profitable_but_volatile',
  LOW_PROFIT_FACTOR: 'low_profit_factor',
  NEGATIVE_EXPECTANCY: 'negative_expectancy',
  LOW_WIN_RATE: 'low_win_rate',
  SYNTHETIC_DATA: 'synthetic_data_only',
  RANDOM_FEATURES: 'random_features',
  QUARANTINE_FAILED: 'quarantine_failed',
  DUPLICATE: 'duplicate',
};

/**
 * Categorize a failure based on metrics.
 * @param {Object} metrics — { profitFactor, winRate, maxDrawdownPct, totalTrades, expectancy }
 * @param {Object} [context] — { isSynthetic, hasRandomFeatures, symbolsTested, oosFailed }
 * @returns {string}
 */
export function categorizeFailure(metrics, context = {}) {
  if (context.isSynthetic) return FAILURE_CATEGORIES.SYNTHETIC_DATA;
  if (context.hasRandomFeatures) return FAILURE_CATEGORIES.RANDOM_FEATURES;
  if (context.oosFailed) return FAILURE_CATEGORIES.FAILS_OOS;
  if ((metrics.totalTrades ?? 0) < 20) return FAILURE_CATEGORIES.LOW_TRADE_COUNT;
  if ((metrics.maxDrawdownPct ?? 0) > 30) return FAILURE_CATEGORIES.BAD_DRAWDOWN;
  if ((metrics.profitFactor ?? 0) < 1.0) return FAILURE_CATEGORIES.LOW_PROFIT_FACTOR;
  if ((metrics.expectancy ?? 0) <= 0) return FAILURE_CATEGORIES.NEGATIVE_EXPECTANCY;
  if ((metrics.winRate ?? 0) < 0.35) return FAILURE_CATEGORIES.LOW_WIN_RATE;
  if (context.symbolsTested && context.symbolsTested.length <= 1) return FAILURE_CATEGORIES.SINGLE_SYMBOL_ONLY;
  return FAILURE_CATEGORIES.LOW_PROFIT_FACTOR;
}

/**
 * Generate a deterministic hash from strategy rules.
 * @param {Array<Object>} rules
 * @returns {string}
 */
export function hashStrategyRules(rules) {
  if (!rules || !Array.isArray(rules)) return '';
  const normalized = rules
    .map(r => `${(r.feature || '').toLowerCase()}:${(r.operator || '').toLowerCase()}:${r.threshold ?? r.value ?? ''}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Record a strategy failure in the failure memory.
 * @param {Object} params
 * @param {string} params.strategyName
 * @param {Array<Object>} params.rules
 * @param {string} [params.rulesHash]
 * @param {string} params.failureReason
 * @param {Object} [params.metrics]
 * @param {string[]} [params.symbolsTested]
 * @param {boolean} [params.isSynthetic]
 * @param {boolean} [params.hasRandomFeatures]
 * @param {boolean} [params.oosFailed]
 */
export function recordFailure(params) {
  const {
    strategyName,
    rules,
    rulesHash: providedRulesHash,
    failureReason,
    metrics = {},
    symbolsTested = [],
    isSynthetic = false,
    hasRandomFeatures = false,
    oosFailed = false,
  } = params;

  const rulesHash = providedRulesHash || hashStrategyRules(rules);
  if (!rulesHash) {
    logger.warn(`[FAILURE-MEMORY] Cannot record failure for ${strategyName}: no rules to hash`);
    return;
  }

  const category = categorizeFailure(metrics, { isSynthetic, hasRandomFeatures, symbolsTested, oosFailed });

  try {
    db.prepare(`
      INSERT INTO strategy_failure_memory
        (rules_hash, strategy_name, failure_reason, failure_category,
         total_trades, win_rate, profit_factor, max_drawdown_pct, expectancy,
         symbols_tested, failed_at, last_failed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(rules_hash) DO UPDATE SET
        failure_count = failure_count + 1,
        last_failed_at = datetime('now'),
        failure_reason = excluded.failure_reason
    `).run(
      rulesHash,
      strategyName,
      failureReason,
      category,
      metrics.totalTrades ?? 0,
      metrics.winRate ?? 0,
      metrics.profitFactor ?? 0,
      metrics.maxDrawdownPct ?? 0,
      metrics.expectancy ?? 0,
      (symbolsTested || []).join(',')
    );

    logger.info(`[FAILURE-MEMORY] Recorded: ${strategyName} → ${category}: ${failureReason}`);
  } catch (e) {
    logger.warn(`[FAILURE-MEMORY] Failed to record failure for ${strategyName}: ${e.message}`);
  }
}

/**
 * Check if a set of rules matches a known failure pattern.
 * @param {Array<Object>} rules
 * @returns {Object|null}
 */
export function findFailureByRules(rules) {
  const hash = hashStrategyRules(rules);
  if (!hash) return null;

  try {
    return db.prepare(`SELECT * FROM strategy_failure_memory WHERE rules_hash = ?`).get(hash) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get all failure records, optionally filtered by category.
 * @param {string} [category]
 * @returns {Array<FailureRecord>}
 */
export function getFailureRecords(category) {
  try {
    if (category) {
      return db.prepare(`
        SELECT * FROM strategy_failure_memory WHERE failure_category = ? ORDER BY failure_count DESC, last_failed_at DESC
      `).all(category);
    }
    return db.prepare(`SELECT * FROM strategy_failure_memory ORDER BY failure_count DESC, last_failed_at DESC`).all();
  } catch (e) {
    return [];
  }
}

/**
 * Get the most common failure categories.
 * @param {number} [limit=5]
 * @returns {Array<{category:string, count:number}>}
 */
export function getFailureCategoryStats(limit = 5) {
  try {
    return db.prepare(`
      SELECT failure_category, COUNT(*) as count, SUM(failure_count) as total_failures
      FROM strategy_failure_memory
      GROUP BY failure_category
      ORDER BY total_failures DESC
      LIMIT ?
    `).all(limit);
  } catch (e) {
    return [];
  }
}

/**
 * Check if a strategy name or hash is in the failure memory.
 * @param {string} strategyName
 * @returns {boolean}
 */
export function isKnownFailure(strategyName) {
  try {
    const record = db.prepare(`
      SELECT id FROM strategy_failure_memory WHERE strategy_name = ?
    `).get(strategyName);
    return !!record;
  } catch (e) {
    return false;
  }
}
