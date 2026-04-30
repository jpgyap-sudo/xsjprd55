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
});
