// ============================================================
// Walk-Forward Validator
// Splits backtest data into train / validation / out-of-sample (OOS)
// windows. A strategy must perform well across ALL three to pass.
// ============================================================

import { calculatePerformanceMetrics } from './performanceMetrics.js';
import { logger } from '../logger.js';

/**
 * @typedef {Object} WalkForwardResult
 * @property {Object} trainMetrics — PerformanceReport on training window
 * @property {Object} valMetrics — PerformanceReport on validation window
 * @property {Object} oosMetrics — PerformanceReport on out-of-sample window
 * @property {boolean} passed — true if all windows meet criteria
 * @property {string[]} failures — reasons for failure
 */

/**
 * @typedef {Object} WalkForwardConfig
 * @property {number} trainRatio — proportion for training (default: 0.50)
 * @property {number} valRatio — proportion for validation (default: 0.25)
 * @property {number} oosRatio — proportion for OOS (default: 0.25)
 * @property {number} minTrainTrades — minimum trades in train window (default: 30)
 * @property {number} minValTrades — minimum trades in validation window (default: 10)
 * @property {number} minOosTrades — minimum trades in OOS window (default: 10)
 * @property {number} minProfitFactor — minimum PF in each window (default: 1.0)
 * @property {number} maxDrawdownPct — max DD in each window (default: 30)
 * @property {number} minOosExpectancy — minimum OOS expectancy (default: 0)
 */

export const DEFAULT_WALK_FORWARD_CONFIG = {
  trainRatio: 0.50,
  valRatio: 0.25,
  oosRatio: 0.25,
  minTrainTrades: 30,
  minValTrades: 10,
  minOosTrades: 10,
  minProfitFactor: 1.0,
  maxDrawdownPct: 30,
  minOosExpectancy: 0,
};

/**
 * Split an array of trades into train/val/OOS windows.
 * @param {Array<{pnlPct:number}>} trades
 * @param {WalkForwardConfig} config
 * @returns {{train:Array, val:Array, oos:Array}}
 */
export function splitWalkForward(trades, config = DEFAULT_WALK_FORWARD_CONFIG) {
  const n = trades.length;
  const trainEnd = Math.floor(n * config.trainRatio);
  const valEnd = trainEnd + Math.floor(n * config.valRatio);

  return {
    train: trades.slice(0, trainEnd),
    val: trades.slice(trainEnd, valEnd),
    oos: trades.slice(valEnd),
  };
}

/**
 * Run walk-forward validation on a set of trades.
 * @param {Array<{pnlPct:number}>} trades — full trade list in chronological order
 * @param {WalkForwardConfig} [config]
 * @returns {WalkForwardResult}
 */
export function validateWalkForward(trades, config = DEFAULT_WALK_FORWARD_CONFIG) {
  if (!trades || trades.length < 20) {
    return {
      trainMetrics: null,
      valMetrics: null,
      oosMetrics: null,
      passed: false,
      failures: ['Insufficient trades for walk-forward validation (< 20)'],
    };
  }

  const { train, val, oos } = splitWalkForward(trades, config);
  const failures = [];

  const trainMetrics = calculatePerformanceMetrics(train);
  const valMetrics = calculatePerformanceMetrics(val);
  const oosMetrics = calculatePerformanceMetrics(oos);

  // Check minimum trade counts
  if (trainMetrics.totalTrades < config.minTrainTrades) {
    failures.push(`Train window: ${trainMetrics.totalTrades} trades < ${config.minTrainTrades}`);
  }
  if (valMetrics.totalTrades < config.minValTrades) {
    failures.push(`Validation window: ${valMetrics.totalTrades} trades < ${config.minValTrades}`);
  }
  if (oosMetrics.totalTrades < config.minOosTrades) {
    failures.push(`OOS window: ${oosMetrics.totalTrades} trades < ${config.minOosTrades}`);
  }

  // Check profit factor across all windows
  if (trainMetrics.profitFactor < config.minProfitFactor) {
    failures.push(`Train PF ${trainMetrics.profitFactor.toFixed(2)} < ${config.minProfitFactor}`);
  }
  if (valMetrics.profitFactor < config.minProfitFactor) {
    failures.push(`Val PF ${valMetrics.profitFactor.toFixed(2)} < ${config.minProfitFactor}`);
  }
  if (oosMetrics.profitFactor < config.minProfitFactor) {
    failures.push(`OOS PF ${oosMetrics.profitFactor.toFixed(2)} < ${config.minProfitFactor}`);
  }

  // Check max drawdown
  if (trainMetrics.maxDrawdownPct > config.maxDrawdownPct) {
    failures.push(`Train DD ${trainMetrics.maxDrawdownPct.toFixed(1)}% > ${config.maxDrawdownPct}%`);
  }
  if (valMetrics.maxDrawdownPct > config.maxDrawdownPct) {
    failures.push(`Val DD ${valMetrics.maxDrawdownPct.toFixed(1)}% > ${config.maxDrawdownPct}%`);
  }
  if (oosMetrics.maxDrawdownPct > config.maxDrawdownPct) {
    failures.push(`OOS DD ${oosMetrics.maxDrawdownPct.toFixed(1)}% > ${config.maxDrawdownPct}%`);
  }

  // Check OOS expectancy specifically
  if (oosMetrics.expectancy <= config.minOosExpectancy) {
    failures.push(`OOS expectancy ${oosMetrics.expectancy.toFixed(4)} <= ${config.minOosExpectancy}`);
  }

  const passed = failures.length === 0;

  logger.info(
    `[WALK-FORWARD] ${passed ? '✅' : '❌'} ` +
    `Train: ${trainMetrics.totalTrades}t PF=${trainMetrics.profitFactor.toFixed(2)} DD=${trainMetrics.maxDrawdownPct.toFixed(1)}% | ` +
    `Val: ${valMetrics.totalTrades}t PF=${valMetrics.profitFactor.toFixed(2)} DD=${valMetrics.maxDrawdownPct.toFixed(1)}% | ` +
    `OOS: ${oosMetrics.totalTrades}t PF=${oosMetrics.profitFactor.toFixed(2)} DD=${oosMetrics.maxDrawdownPct.toFixed(1)}% Exp=${oosMetrics.expectancy.toFixed(4)}`
  );

  return {
    trainMetrics,
    valMetrics,
    oosMetrics,
    passed,
    failures,
  };
}
