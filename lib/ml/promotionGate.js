// ============================================================
// Promotion Gate v2 — Research Agent Quality Gate
// Blocks promotion unless ALL conditions are met:
//   1. Real data (non-synthetic candles)
//   2. Non-random features (no Math.random fallback)
//   3. 50+ trades minimum
//   4. Profit factor > 1.25
//   5. Max drawdown < 20%
//   6. Win rate >= 0.45 (minimum viable)
//   7. Positive expectancy
//   8. Walk-forward: positive OOS expectancy
//   9. Source credibility >= minimum threshold
//  10. Not a duplicate of an existing/failed strategy
// ============================================================

import { calculatePerformanceMetrics } from './performanceMetrics.js';
import { logger } from '../logger.js';

// ── Default Gate Configuration ─────────────────────────────
export const PROMOTION_GATE_DEFAULTS = {
  minTotalTrades: 50,
  minProfitFactor: 1.25,
  maxDrawdownPct: 20,
  minWinRate: 0.45,
  minExpectancy: 0,           // must be positive
  minOosExpectancy: 0,        // out-of-sample must be positive
  minSourceCredibility: 0.3,  // 0..1 scale
  requireRealData: true,      // block synthetic/dummy candles
  requireNonRandomFeatures: true, // block backtests with random feature fallback
  requireWalkForward: true,   // require train/val/OOS split validation
  requirePositiveExpectancy: true,
};

// ── Source Credibility Scores ──────────────────────────────
export const SOURCE_CREDIBILITY = {
  binance_funding: 0.9,
  binance_futures_data: 0.9,
  tradingview_ideas: 0.85,
  tradingview_ta: 0.85,
  coingecko_global: 0.7,
  coingecko_market: 0.7,
  hyperliquid_intel: 0.75,
  lunarcrush: 0.6,
  cryptopanic_news: 0.5,
  social_sentiment_x: 0.3,
  macro_analysis: 0.65,
  news_api: 0.5,
  default: 0.4,
};

/**
 * Get credibility score for a source name.
 * @param {string} sourceName
 * @returns {number}
 */
export function getSourceCredibility(sourceName) {
  return SOURCE_CREDIBILITY[sourceName] ?? SOURCE_CREDIBILITY.default;
}

// ── Promotion Gate Result ──────────────────────────────────
/**
 * @typedef {Object} GateResult
 * @property {boolean} approved — true if ALL gates pass
 * @property {string[]} failures — list of failed gate descriptions
 * @property {Object} details — per-gate breakdown
 * @property {number} score — composite promotion score (0..1)
 */

// ── Main Gate Function ─────────────────────────────────────
/**
 * Evaluate a backtest result against the promotion gate.
 * @param {Object} backtest — backtest result with metrics
 * @param {Object} [opts] — override gate configuration
 * @param {Object} [opts.metrics] — pre-computed PerformanceReport (optional)
 * @param {Object} [opts.walkForward] — { trainMetrics, valMetrics, oosMetrics }
 * @param {boolean} [opts.isSynthetic] — true if backtest used dummy candles
 * @param {boolean} [opts.hasRandomFeatures] — true if backtest used Math.random for features
 * @param {number} [opts.sourceCredibility] — source credibility score (0..1)
 * @param {string} [opts.sourceName] — source name for credibility lookup
 * @param {Object} [opts.customCriteria] — override PROMOTION_GATE_DEFAULTS
 * @returns {GateResult}
 */
export function evaluatePromotionGate(backtest, opts = {}) {
  const criteria = { ...PROMOTION_GATE_DEFAULTS, ...(opts.customCriteria || {}) };
  const failures = [];
  const details = {};

  // Compute metrics if not provided
  const metrics = opts.metrics || calculatePerformanceMetrics(
    (backtest.tradeLog || backtest.trades || []).map(t => ({ pnlPct: t.pnlPct ?? t.pnl_pct ?? 0 }))
  );

  // ── Gate 1: Real Data Check ──────────────────────────────
  const isSynthetic = opts.isSynthetic ?? backtest.isSynthetic ?? false;
  details.realData = {
    passed: !criteria.requireRealData || !isSynthetic,
    value: isSynthetic ? 'synthetic' : 'real',
    required: 'real data',
  };
  if (!details.realData.passed) {
    failures.push('Blocked: backtest used synthetic/dummy candles. Real OHLCV data required.');
  }

  // ── Gate 2: Non-Random Features Check ────────────────────
  const hasRandomFeatures = opts.hasRandomFeatures ?? backtest.hasRandomFeatures ?? false;
  details.nonRandomFeatures = {
    passed: !criteria.requireNonRandomFeatures || !hasRandomFeatures,
    value: hasRandomFeatures ? 'random_features' : 'real_features',
    required: 'real feature data',
  };
  if (!details.nonRandomFeatures.passed) {
    failures.push('Blocked: backtest used Math.random() for features. Real feature snapshots required.');
  }

  // ── Gate 3: Minimum Trade Count ──────────────────────────
  const totalTrades = backtest.totalTrades ?? metrics.totalTrades ?? 0;
  details.minTrades = {
    passed: totalTrades >= criteria.minTotalTrades,
    value: totalTrades,
    required: `>= ${criteria.minTotalTrades}`,
  };
  if (!details.minTrades.passed) {
    failures.push(`Blocked: only ${totalTrades} trades. Minimum ${criteria.minTotalTrades} required.`);
  }

  // ── Gate 4: Profit Factor ────────────────────────────────
  const profitFactor = backtest.profitFactor ?? metrics.profitFactor ?? 0;
  details.profitFactor = {
    passed: profitFactor >= criteria.minProfitFactor,
    value: Number(profitFactor.toFixed(4)),
    required: `>= ${criteria.minProfitFactor}`,
  };
  if (!details.profitFactor.passed) {
    failures.push(`Blocked: profit factor ${profitFactor.toFixed(2)} < ${criteria.minProfitFactor}.`);
  }

  // ── Gate 5: Max Drawdown ─────────────────────────────────
  const maxDrawdownPct = backtest.maxDrawdownPct ?? metrics.maxDrawdownPct ?? 0;
  details.maxDrawdown = {
    passed: maxDrawdownPct <= criteria.maxDrawdownPct,
    value: Number(maxDrawdownPct.toFixed(2)),
    required: `<= ${criteria.maxDrawdownPct}%`,
  };
  if (!details.maxDrawdown.passed) {
    failures.push(`Blocked: max drawdown ${maxDrawdownPct.toFixed(1)}% > ${criteria.maxDrawdownPct}%.`);
  }

  // ── Gate 6: Win Rate ─────────────────────────────────────
  const winRate = backtest.winRate ?? metrics.winRate ?? 0;
  details.winRate = {
    passed: winRate >= criteria.minWinRate,
    value: Number((winRate * 100).toFixed(1)) + '%',
    required: `>= ${(criteria.minWinRate * 100).toFixed(0)}%`,
  };
  if (!details.winRate.passed) {
    failures.push(`Blocked: win rate ${(winRate * 100).toFixed(1)}% < ${(criteria.minWinRate * 100).toFixed(0)}%.`);
  }

  // ── Gate 7: Positive Expectancy ──────────────────────────
  const expectancy = backtest.expectancy ?? metrics.expectancy ?? 0;
  details.expectancy = {
    passed: !criteria.requirePositiveExpectancy || expectancy > criteria.minExpectancy,
    value: Number(expectancy.toFixed(4)),
    required: `> ${criteria.minExpectancy}`,
  };
  if (!details.expectancy.passed) {
    failures.push(`Blocked: expectancy ${expectancy.toFixed(4)} <= ${criteria.minExpectancy}. Positive expectancy required.`);
  }

  // ── Gate 8: Walk-Forward Validation ──────────────────────
  if (criteria.requireWalkForward && opts.walkForward) {
    const { oosMetrics } = opts.walkForward;
    const oosExpectancy = oosMetrics?.expectancy ?? -Infinity;
    details.walkForward = {
      passed: oosExpectancy > criteria.minOosExpectancy,
      value: Number(oosExpectancy.toFixed(4)),
      required: `OOS expectancy > ${criteria.minOosExpectancy}`,
      trainTrades: opts.walkForward.trainMetrics?.totalTrades || 0,
      valTrades: opts.walkForward.valMetrics?.totalTrades || 0,
      oosTrades: opts.walkForward.oosMetrics?.totalTrades || 0,
    };
    if (!details.walkForward.passed) {
      failures.push(`Blocked: out-of-sample expectancy ${oosExpectancy.toFixed(4)} <= ${criteria.minOosExpectancy}. Walk-forward validation failed.`);
    }
  } else if (criteria.requireWalkForward && !opts.walkForward) {
    details.walkForward = {
      passed: false,
      value: 'not_provided',
      required: 'walk-forward validation data',
    };
    failures.push('Blocked: walk-forward validation data not provided. Required for promotion.');
  }

  // ── Gate 9: Source Credibility ───────────────────────────
  const sourceCredibility = opts.sourceCredibility ??
    (opts.sourceName ? getSourceCredibility(opts.sourceName) : null);
  if (sourceCredibility !== null) {
    details.sourceCredibility = {
      passed: sourceCredibility >= criteria.minSourceCredibility,
      value: Number(sourceCredibility.toFixed(2)),
      required: `>= ${criteria.minSourceCredibility}`,
      sourceName: opts.sourceName || 'unknown',
    };
    if (!details.sourceCredibility.passed) {
      failures.push(`Blocked: source credibility ${sourceCredibility.toFixed(2)} < ${criteria.minSourceCredibility}. Source: ${opts.sourceName || 'unknown'}`);
    }
  }

  // ── Gate 10: Duplicate Check (handled externally) ────────
  // The duplicate detector is called separately; this gate just flags it.
  details.duplicateCheck = {
    passed: true, // assumed — caller must verify
    note: 'External duplicate detection should be run before promotion',
  };

  // ── Composite Score ──────────────────────────────────────
  const score = computePromotionScore({
    profitFactor,
    winRate,
    maxDrawdownPct,
    totalTrades,
    expectancy,
    sourceCredibility: sourceCredibility ?? 0.5,
    walkForwardPassed: details.walkForward?.passed ?? false,
    realDataPassed: details.realData.passed,
  });

  const approved = failures.length === 0;

  if (approved) {
    logger.info(`[PROMOTION-GATE] ✅ ${backtest.strategyName || 'unknown'} passed all ${Object.keys(details).length} gates (score=${score.toFixed(3)})`);
  } else {
    logger.warn(`[PROMOTION-GATE] ❌ ${backtest.strategyName || 'unknown'} blocked: ${failures.length} failures (score=${score.toFixed(3)})`);
  }

  return { approved, failures, details, score };
}

// ── Composite Promotion Score ──────────────────────────────
/**
 * Compute a weighted promotion score (0..1) from gate metrics.
 * Used for ranking, not for gate approval.
 */
export function computePromotionScore(m) {
  const pfScore = Math.min(m.profitFactor / 3, 1) * 0.20;
  const wrScore = m.winRate * 0.15;
  const ddScore = Math.max(0, 1 - (m.maxDrawdownPct || 0) / 50) * 0.15;
  const tradeScore = Math.min((m.totalTrades || 0) / 100, 1) * 0.10;
  const expScore = Math.tanh(Math.max(m.expectancy || 0, 0) * 5) * 0.15;
  const srcScore = (m.sourceCredibility || 0.5) * 0.10;
  const wfScore = m.walkForwardPassed ? 0.10 : 0;
  const realScore = m.realDataPassed ? 0.05 : 0;

  return Number(
    (pfScore + wrScore + ddScore + tradeScore + expScore + srcScore + wfScore + realScore).toFixed(4)
  );
}

// ── Quick Check (for simple callers) ───────────────────────
/**
 * Quick boolean check — does this backtest pass the gate?
 * @param {Object} backtest
 * @param {Object} [opts]
 * @returns {boolean}
 */
export function passesPromotionGate(backtest, opts = {}) {
  return evaluatePromotionGate(backtest, opts).approved;
}

// ── Generate rejection summary for logging ─────────────────
/**
 * Get a human-readable rejection summary.
 * @param {GateResult} gateResult
 * @returns {string}
 */
export function formatRejection(gateResult) {
  if (gateResult.approved) return 'PASSED';
  return gateResult.failures.map(f => `  ❌ ${f}`).join('\n');
}
