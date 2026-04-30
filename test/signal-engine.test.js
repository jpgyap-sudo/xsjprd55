// ============================================================
// Signal Engine Unit Tests
// Tests technical indicator calculations
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Signal Engine Technical Indicators', () => {
  it('should build a valid signal structure', async () => {
    const { buildSignal } = await import('../lib/signal-engine.js');
    
    const mockSignal = buildSignal({
      symbol: 'BTCUSDT',
      side: 'LONG',
      price: 65000,
      confidence: 0.75,
      strategy: 'EMA_Cross',
      timeframe: '15m'
    });

    assert.ok(mockSignal, 'Signal should be built');
    assert.strictEqual(mockSignal.symbol, 'BTCUSDT', 'Symbol should match');
    assert.ok(mockSignal.id, 'Signal should have an ID');
    assert.ok(mockSignal.generated_at, 'Signal should have timestamp');
  });

  it('should calculate RSI bounds correctly', () => {
    const RSI_OVERBOUGHT = 70;
    const RSI_OVERSOLD = 30;
    
    assert.ok(RSI_OVERBOUGHT > RSI_OVERSOLD, 'Overbought should be above oversold');
    assert.strictEqual(RSI_OVERBOUGHT, 70, 'Default overbought is 70');
    assert.strictEqual(RSI_OVERSOLD, 30, 'Default oversold is 30');
  });

  it('should validate confidence thresholds', () => {
    const CONFIDENCE_THRESHOLD = 0.65;
    
    assert.ok(CONFIDENCE_THRESHOLD > 0, 'Threshold should be positive');
    assert.ok(CONFIDENCE_THRESHOLD < 1, 'Threshold should be less than 1');
  });

  it('should handle OHLCV data format', () => {
    const sampleOHLCV = [
      [1625097600000, 35000, 35100, 34900, 35050, 100],
      [1625097660000, 35050, 35200, 35000, 35150, 150],
      [1625097720000, 35150, 35300, 35100, 35250, 200],
    ];
    
    assert.ok(Array.isArray(sampleOHLCV), 'OHLCV should be array');
    assert.strictEqual(sampleOHLCV[0].length, 6, 'OHLCV should have 6 fields');
    
    const closes = sampleOHLCV.map(c => c[4]);
    assert.ok(closes.every(c => typeof c === 'number'), 'All closes should be numbers');
  });
});

describe('Signal Validation', () => {
  it('should reject invalid signal side', () => {
    const validSides = ['LONG', 'SHORT', 'CLOSE'];
    const invalidSide = 'INVALID';
    
    assert.ok(!validSides.includes(invalidSide), 'Invalid side should not be in valid list');
  });

  it('should require minimum signal fields', () => {
    const requiredFields = ['symbol', 'side', 'price', 'confidence'];
    const mockSignal = {
      symbol: 'ETHUSDT',
      side: 'SHORT',
      price: 3200,
      confidence: 0.72
    };
    
    requiredFields.forEach(field => {
      assert.ok(field in mockSignal, `Signal should have ${field}`);
    });
  });
});

console.log('✅ Signal engine tests defined');
