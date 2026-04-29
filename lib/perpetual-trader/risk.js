// ============================================================
// Perpetual Trader — Risk Management
// Position sizing, leverage, stop-loss, take-profit,
// daily limits, drawdown controls.
// ============================================================

import { logger } from '../logger.js';

/**
 * Calculate position size based on risk parameters
 * @param {Object} opts
 * @param {number} opts.equity         — current account equity
 * @param {number} opts.entryPrice     — planned entry price
 * @param {number} opts.stopLoss       — stop loss price
 * @param {number} opts.riskPct        — % of equity to risk (0.01 = 1%)
 * @param {number} opts.leverage       — desired leverage
 * @param {number} opts.maxPositionUsd — max $ position size
 * @returns {Object} { sizeUsd, marginUsed, quantity, riskUsd, riskReward }
 */
export function calculatePositionSize({ equity, entryPrice, stopLoss, riskPct = 0.01, leverage = 3, maxPositionUsd = Infinity }) {
  if (!equity || !entryPrice || !stopLoss || entryPrice === stopLoss) {
    return { sizeUsd: 0, marginUsed: 0, quantity: 0, riskUsd: 0, riskReward: 0, ok: false, reason: 'Invalid inputs' };
  }
  
  const riskUsd = equity * riskPct;
  const priceRiskPerUnit = Math.abs(entryPrice - stopLoss);
  const quantity = riskUsd / priceRiskPerUnit;
  let sizeUsd = quantity * entryPrice;
  
  // Cap position size
  if (sizeUsd > maxPositionUsd) {
    sizeUsd = maxPositionUsd;
    const cappedQty = sizeUsd / entryPrice;
    // Recalculate actual risk with cap
    const actualRisk = cappedQty * priceRiskPerUnit;
    logger.warn(`[Risk] Position capped at $${maxPositionUsd.toFixed(0)}. Actual risk: $${actualRisk.toFixed(2)} (${(actualRisk/equity*100).toFixed(2)}%)`);
  }
  
  const marginUsed = sizeUsd / leverage;
  const rr = riskUsd > 0 ? (sizeUsd * 0.02) / riskUsd : 0; // Approximate 2% target
  
  return {
    ok: true,
    sizeUsd: Math.round(sizeUsd * 100) / 100,
    marginUsed: Math.round(marginUsed * 100) / 100,
    quantity: Math.round(quantity * 1e6) / 1e6,
    riskUsd: Math.round(riskUsd * 100) / 100,
    riskReward: Math.round(rr * 100) / 100,
  };
}

/**
 * Determine leverage based on confidence and volatility
 */
export function selectLeverage({ confidence, volatilityPct = 2, maxLeverage = 10, defaultLeverage = 3 }) {
  const confPct = (confidence || 0) * 100;
  
  if (confPct < 55) return 0; // Skip
  if (confPct < 65) return Math.min(2, maxLeverage);
  if (confPct < 75) return Math.min(defaultLeverage, maxLeverage);
  if (confPct < 85) return Math.min(defaultLeverage + 2, maxLeverage);
  return Math.min(defaultLeverage + 4, maxLeverage);
}

/**
 * Calculate adaptive stop loss and take profit
 */
export function calculateStops({ entryPrice, side, atr, volatilityPct = 2, riskRewardMin = 1.5 }) {
  const stopDistance = entryPrice * (volatilityPct / 100) * 0.75;
  const tpDistance = stopDistance * Math.max(riskRewardMin, 2);
  
  const stopLoss = side === 'LONG'
    ? entryPrice - stopDistance
    : entryPrice + stopDistance;
  
  const takeProfit = side === 'LONG'
    ? entryPrice + tpDistance
    : entryPrice - tpDistance;
  
  return {
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    riskReward: Math.round((tpDistance / stopDistance) * 100) / 100,
  };
}

/**
 * Check all risk gates before opening a trade
 */
export async function checkRiskGates(account, signal, openTrades = []) {
  const issues = [];
  
  // Account health
  if (!account.trading_enabled) {
    issues.push(`Trading paused: ${account.trading_paused_reason || 'Unknown'}`);
  }
  
  // Confidence check
  const confPct = (signal.confidence || 0) * 100;
  const minConf = (account.min_confidence_threshold || 0.55) * 100;
  if (confPct < minConf) {
    issues.push(`Confidence ${confPct.toFixed(0)}% below threshold ${minConf.toFixed(0)}%`);
  }
  
  // Max open trades
  const openCount = openTrades.filter(t => t.status === 'open').length;
  if (openCount >= account.max_open_trades) {
    issues.push(`Max open trades reached (${account.max_open_trades})`);
  }
  
  // Daily loss limit
  const dailyLossLimit = account.starting_balance * (account.daily_max_loss_pct || 0.05);
  if (account.daily_pnl_today <= -dailyLossLimit) {
    issues.push(`Daily loss limit hit ($${dailyLossLimit.toFixed(0)})`);
  }
  
  // Max drawdown
  const maxDD = account.starting_balance * (account.max_drawdown_stop_pct || 0.15);
  const currentDD = account.peak_balance - account.current_balance;
  if (currentDD >= maxDD) {
    issues.push(`Max drawdown reached ($${currentDD.toFixed(0)} / $${maxDD.toFixed(0)})`);
  }
  
  // Exposure per coin
  const sameSymbolTrades = openTrades.filter(t => t.symbol === signal.symbol && t.status === 'open');
  const sameSymbolExposure = sameSymbolTrades.reduce((s, t) => s + (t.position_size_usd || 0), 0);
  const maxExposure = account.equity * (account.max_exposure_pct || 0.25);
  if (sameSymbolExposure >= maxExposure) {
    issues.push(`Max exposure for ${signal.symbol} reached ($${sameSymbolExposure.toFixed(0)})`);
  }
  
  // Existing same-side position check
  const sameSide = sameSymbolTrades.filter(t => t.side === signal.side);
  if (sameSide.length > 0) {
    issues.push(`Already have ${signal.side} position in ${signal.symbol}`);
  }
  
  return {
    ok: issues.length === 0,
    issues,
    confPct,
    openCount,
    sameSymbolExposure,
  };
}

/**
 * Check if a trade should be closed based on current price
 */
export function checkExit({ side, entryPrice, currentPrice, stopLoss, takeProfit }) {
  if (!stopLoss && !takeProfit) return { shouldExit: false };
  
  if (side === 'LONG') {
    if (stopLoss && currentPrice <= stopLoss) return { shouldExit: true, reason: 'sl', exitPrice: currentPrice };
    if (takeProfit && currentPrice >= takeProfit) return { shouldExit: true, reason: 'tp', exitPrice: currentPrice };
  } else {
    if (stopLoss && currentPrice >= stopLoss) return { shouldExit: true, reason: 'sl', exitPrice: currentPrice };
    if (takeProfit && currentPrice <= takeProfit) return { shouldExit: true, reason: 'tp', exitPrice: currentPrice };
  }
  
  return { shouldExit: false };
}

/**
 * Calculate PnL for a perpetual position
 */
export function calculatePerpPnl({ side, entryPrice, exitPrice, sizeUsd, leverage }) {
  const margin = sizeUsd / leverage;
  const priceChange = side === 'LONG'
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const pnlUsd = sizeUsd * priceChange;
  const pnlPct = (pnlUsd / margin) * 100;
  return { pnlUsd: Math.round(pnlUsd * 100) / 100, pnlPct: Math.round(pnlPct * 100) / 100 };
}
