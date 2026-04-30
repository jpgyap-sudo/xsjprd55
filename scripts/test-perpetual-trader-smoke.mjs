// ============================================================
// Perpetual Trader Smoke Test
// Runs without node:test so sandboxed environments that block
// child-process test spawning can still verify the core logic.
// ============================================================

import assert from 'node:assert/strict';

import { shouldRetrySignal } from '../workers/perpetual-trader-worker.js';
import {
  calculatePerpPnl,
  calculatePositionSize,
  calculateStops,
  checkExit,
  selectLeverage,
} from '../lib/perpetual-trader/risk.js';

assert.equal(shouldRetrySignal('Price unavailable'), true);
assert.equal(shouldRetrySignal('network timeout'), true);
assert.equal(shouldRetrySignal('Confidence 40% below threshold 55%'), false);
assert.equal(shouldRetrySignal('Already have LONG position in BTCUSDT'), false);

assert.equal(selectLeverage({ confidence: 0.54, maxLeverage: 10, defaultLeverage: 3 }), 0);
assert.equal(selectLeverage({ confidence: 0.55, maxLeverage: 10, defaultLeverage: 3 }), 2);

const longStops = calculateStops({ entryPrice: 100, side: 'LONG', volatilityPct: 2, riskRewardMin: 1.5 });
assert.deepEqual(longStops, { stopLoss: 98.5, takeProfit: 103, riskReward: 2 });
assert.deepEqual(
  checkExit({ side: 'LONG', entryPrice: 100, currentPrice: 103.1, stopLoss: longStops.stopLoss, takeProfit: longStops.takeProfit }),
  { shouldExit: true, reason: 'tp', exitPrice: 103.1 }
);

const shortStops = calculateStops({ entryPrice: 100, side: 'SHORT', volatilityPct: 2, riskRewardMin: 1.5 });
assert.deepEqual(shortStops, { stopLoss: 101.5, takeProfit: 97, riskReward: 2 });

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

const pnl = calculatePerpPnl({ side: 'LONG', entryPrice: 100, exitPrice: 103, sizeUsd: 25000, leverage: 5 });
assert.deepEqual(pnl, { pnlUsd: 750, pnlPct: 15 });

console.log('Perpetual trader smoke test passed');
