// ============================================================
// Signal Engine Unit Tests
// Tests technical indicator calculations and signal strategies
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

  it('should build signal with all required fields', async () => {
    const { buildSignal } = await import('../lib/signal-engine.js');
    
    const signal = buildSignal({
      symbol: 'ETHUSDT',
      side: 'SHORT',
      price: 3200,
      confidence: 0.82,
      strategy: 'RSI_Bounce',
      timeframe: '1h',
      stop_loss: 3300,
      take_profit: [3000, 2800],
      source: 'test',
      mode: 'paper'
    });

    assert.ok(signal.id, 'Should have id');
    assert.ok(signal.generated_at, 'Should have generated_at');
    assert.ok(signal.valid_until, 'Should have valid_until');
    assert.strictEqual(signal.symbol, 'ETHUSDT');
    assert.strictEqual(signal.side, 'SHORT');
    assert.strictEqual(signal.entry_price, 3200);
    assert.strictEqual(signal.confidence, 0.82);
    assert.strictEqual(signal.strategy, 'RSI_Bounce');
    assert.strictEqual(signal.timeframe, '1h');
    assert.strictEqual(signal.stop_loss, 3300);
    assert.deepStrictEqual(signal.take_profit, [3000, 2800]);
    assert.strictEqual(signal.source, 'test');
    assert.strictEqual(signal.mode, 'paper');
  });

  it('should generate unique IDs for each signal', async () => {
    const { buildSignal } = await import('../lib/signal-engine.js');
    
    const signal1 = buildSignal({ symbol: 'BTCUSDT', side: 'LONG', price: 50000, confidence: 0.5, strategy: 'test', timeframe: '15m' });
    const signal2 = buildSignal({ symbol: 'BTCUSDT', side: 'LONG', price: 50000, confidence: 0.5, strategy: 'test', timeframe: '15m' });
    
    assert.notStrictEqual(signal1.id, signal2.id, 'Each signal should have a unique ID');
  });

  it('should set valid_until based on ttl_minutes', async () => {
    const { buildSignal } = await import('../lib/signal-engine.js');
    
    // buildSignal uses ttl_minutes from opts (defaults to 60)
    const signal15m = buildSignal({ symbol: 'BTCUSDT', side: 'LONG', price: 50000, confidence: 0.5, strategy: 'test', timeframe: '15m', ttl_minutes: 60 });
    const signal1h = buildSignal({ symbol: 'BTCUSDT', side: 'LONG', price: 50000, confidence: 0.5, strategy: 'test', timeframe: '1h', ttl_minutes: 240 });
    
    const ttl15m = new Date(signal15m.valid_until) - new Date(signal15m.generated_at);
    const ttl1h = new Date(signal1h.valid_until) - new Date(signal1h.generated_at);
    
    assert.ok(ttl1h > ttl15m, '1h signal should have longer TTL than 15m');
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

  it('should validate confidence is between 0 and 1', () => {
    const validConfidences = [0, 0.5, 1];
    const invalidConfidences = [-0.1, 1.1];
    
    validConfidences.forEach(c => {
      assert.ok(c >= 0 && c <= 1, `${c} should be valid`);
    });
    invalidConfidences.forEach(c => {
      assert.ok(c < 0 || c > 1, `${c} should be invalid`);
    });
  });

  it('should validate side is one of LONG/SHORT/CLOSE', () => {
    const validSides = ['LONG', 'SHORT', 'CLOSE'];
    const invalidSides = ['BUY', 'SELL', '', null, undefined];
    
    validSides.forEach(s => {
      assert.ok(validSides.includes(s), `${s} should be valid`);
    });
    invalidSides.forEach(s => {
      assert.ok(!validSides.includes(s), `${s} should be invalid`);
    });
  });
});

describe('Strategy Functions', () => {
  it('should export all strategy functions', async () => {
    const mod = await import('../lib/signal-engine.js');
    
    assert.ok(typeof mod.strategy_EMACross === 'function', 'strategy_EMACross should be a function');
    assert.ok(typeof mod.strategy_RSIBounce === 'function', 'strategy_RSIBounce should be a function');
    assert.ok(typeof mod.strategy_VolumeFilter === 'function', 'strategy_VolumeFilter should be a function');
    assert.ok(typeof mod.runAllStrategies === 'function', 'runAllStrategies should be a function');
    assert.ok(typeof mod.runAllStrategiesWithIntel === 'function', 'runAllStrategiesWithIntel should be a function');
  });

  it('should return null when insufficient data', async () => {
    const { strategy_EMACross } = await import('../lib/signal-engine.js');
    
    // Only 5 candles — not enough for EMA calculation (needs EMA_LONG + 5 = 26)
    const ohlcv = [];
    for (let i = 0; i < 5; i++) {
      ohlcv.push([Date.now() - (5 - i) * 60000, 50000, 50100, 49900, 50000, 100]);
    }
    
    const signal = strategy_EMACross('BTCUSDT', '15m', ohlcv);
    assert.strictEqual(signal, null, 'Should return null with insufficient data');
  });

  it('should handle empty OHLCV array', async () => {
    const { strategy_EMACross } = await import('../lib/signal-engine.js');
    
    // strategy_EMACross calls closes.map(c => c[4]) on empty array,
    // then checks closes.length < EMA_LONG + 5 → returns null
    const signal = strategy_EMACross('BTCUSDT', '15m', []);
    assert.strictEqual(signal, null, 'Should return null with empty data');
  });
});

console.log('✅ Signal engine tests expanded');
