// ============================================================
// Perpetual Trader Tests
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { shouldRetrySignal } from '../workers/perpetual-trader-worker.js';
import {
  calculatePositionSize,
  calculateStops,
  checkExit,
  selectLeverage,
} from '../lib/perpetual-trader/risk.js';

describe('Perpetual trader retry handling', () => {
  it('retries transient signal skips', () => {
    assert.equal(shouldRetrySignal('Price unavailable'), true);
    assert.equal(shouldRetrySignal('fetch failed: network timeout'), true);
    assert.equal(shouldRetrySignal('schema cache missing table'), true);
  });

  it('does not retry deterministic risk skips', () => {
    assert.equal(shouldRetrySignal('Confidence 40% below threshold 55%'), false);
    assert.equal(shouldRetrySignal('Already have LONG position in BTCUSDT'), false);
  });

  it('does not retry exchange connection errors by default', () => {
    // shouldRetrySignal checks TRANSIENT_SKIP_REASONS which includes
    // 'network', 'fetch', 'timeout', 'schema cache', 'does not exist'
    // 'exchange error' and 'rate limit' are NOT in the transient list
    assert.equal(shouldRetrySignal('exchange error: connection refused'), false);
    assert.equal(shouldRetrySignal('rate limit exceeded, retry later'), false);
  });

  it('does not retry invalid symbol errors', () => {
    assert.equal(shouldRetrySignal('Invalid symbol: XXXUSDT'), false);
    assert.equal(shouldRetrySignal('Symbol not found'), false);
  });

  it('does not retry configuration errors', () => {
    assert.equal(shouldRetrySignal('Trading mode is not live'), false);
    assert.equal(shouldRetrySignal('Mock trading disabled'), false);
  });
});

describe('Perpetual trader risk math', () => {
  it('selects zero leverage below confidence gate', () => {
    assert.equal(selectLeverage({ confidence: 0.54, maxLeverage: 10, defaultLeverage: 3 }), 0);
    assert.equal(selectLeverage({ confidence: 0.55, maxLeverage: 10, defaultLeverage: 3 }), 2);
  });

  it('calculates long stops and exits', () => {
    const stops = calculateStops({ entryPrice: 100, side: 'LONG', volatilityPct: 2, riskRewardMin: 1.5 });
    assert.equal(stops.stopLoss, 98.5);
    assert.equal(stops.takeProfit, 103);
    assert.equal(checkExit({ side: 'LONG', entryPrice: 100, currentPrice: 98.4, stopLoss: stops.stopLoss, takeProfit: stops.takeProfit }).shouldExit, true);
    assert.equal(checkExit({ side: 'LONG', entryPrice: 100, currentPrice: 103.1, stopLoss: stops.stopLoss, takeProfit: stops.takeProfit }).reason, 'tp');
  });

  it('caps position size by max exposure', () => {
    const sizing = calculatePositionSize({
      equity: 100000,
      entryPrice: 100,
      stopLoss: 99,
      riskPct: 0.01,
      leverage: 5,
      maxPositionUsd: 25000,
    });
    assert.equal(sizing.ok, true);
    assert.equal(sizing.sizeUsd, 25000);
    assert.equal(sizing.marginUsed, 5000);
  });

  it('calculates short stops and exits', () => {
    const stops = calculateStops({ entryPrice: 100, side: 'SHORT', volatilityPct: 2, riskRewardMin: 2 });
    assert.equal(stops.stopLoss, 101.5);
    assert.equal(stops.takeProfit, 97);
  });

  it('detects stop loss exit for short', () => {
    const stops = calculateStops({ entryPrice: 100, side: 'SHORT', volatilityPct: 2, riskRewardMin: 2 });
    const exit = checkExit({ side: 'SHORT', entryPrice: 100, currentPrice: 101.6, stopLoss: stops.stopLoss, takeProfit: stops.takeProfit });
    assert.equal(exit.shouldExit, true);
    assert.equal(exit.reason, 'sl');
  });

  it('detects take profit exit for short', () => {
    const stops = calculateStops({ entryPrice: 100, side: 'SHORT', volatilityPct: 2, riskRewardMin: 2 });
    const exit = checkExit({ side: 'SHORT', entryPrice: 100, currentPrice: 96.9, stopLoss: stops.stopLoss, takeProfit: stops.takeProfit });
    assert.equal(exit.shouldExit, true);
    assert.equal(exit.reason, 'tp');
  });

  it('does not exit when price is within range', () => {
    const stops = calculateStops({ entryPrice: 100, side: 'LONG', volatilityPct: 2, riskRewardMin: 1.5 });
    const exit = checkExit({ side: 'LONG', entryPrice: 100, currentPrice: 100.5, stopLoss: stops.stopLoss, takeProfit: stops.takeProfit });
    assert.equal(exit.shouldExit, false);
  });

  it('selects higher leverage with higher confidence', () => {
    const low = selectLeverage({ confidence: 0.6, maxLeverage: 10, defaultLeverage: 3 });
    const high = selectLeverage({ confidence: 0.85, maxLeverage: 10, defaultLeverage: 3 });
    assert.ok(high >= low, 'Higher confidence should allow higher or equal leverage');
  });

  it('caps leverage at maxLeverage', () => {
    const result = selectLeverage({ confidence: 0.95, maxLeverage: 5, defaultLeverage: 3 });
    assert.ok(result <= 5, 'Leverage should not exceed maxLeverage');
  });

  it('calculates position size without cap', () => {
    const sizing = calculatePositionSize({
      equity: 100000,
      entryPrice: 100,
      stopLoss: 99,
      riskPct: 0.01,
      leverage: 5,
      maxPositionUsd: 1000000, // High cap
    });
    assert.equal(sizing.ok, true);
    // riskUsd = 100000 * 0.01 = 1000
    // priceRiskPerUnit = |100 - 99| = 1
    // quantity = 1000 / 1 = 1000
    // sizeUsd = 1000 * 100 = 100000
    assert.equal(sizing.sizeUsd, 100000);
    // marginUsed = 100000 / 5 = 20000
    assert.equal(sizing.marginUsed, 20000);
  });
});

console.log('✅ Perpetual trader tests expanded');
