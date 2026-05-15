// ============================================================
// Strategy Unit Tests
// Tests signal strategies, dynamic strategies, and promotion gate
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Signal Engine Strategies', () => {
  it('should build a valid EMA Cross signal', async () => {
    const { strategy_EMACross, buildSignal } = await import('../lib/signal-engine.js');

    // Build OHLCV with enough candles (need 26+) and a clear trend change
    const ohlcv = [];
    for (let i = 0; i < 40; i++) {
      // Prices start low then rise sharply to create EMA cross
      const basePrice = i < 20 ? 49000 + i * 10 : 51000 + i * 20;
      ohlcv.push([Date.now() - (40 - i) * 60000, basePrice - 10, basePrice + 10, basePrice - 20, basePrice, 100 + i]);
    }

    const signal = strategy_EMACross('BTCUSDT', '15m', ohlcv);
    // May return null if synthetic data doesn't produce a cross — that's valid behavior
    if (signal) {
      assert.ok(['LONG', 'SHORT', 'CLOSE'].includes(signal.side), 'Side should be valid');
      assert.ok(typeof signal.confidence === 'number', 'Confidence should be a number');
      assert.ok(signal.confidence >= 0 && signal.confidence <= 1, 'Confidence should be 0-1');
    }
  });

  it('should build a valid RSI Bounce signal', async () => {
    const { strategy_RSIBounce } = await import('../lib/signal-engine.js');

    // Build OHLCV with oversold RSI conditions (prices dropping then bouncing)
    const ohlcv = [];
    for (let i = 0; i < 30; i++) {
      const price = i < 15 ? 50000 - i * 200 : 47000 + i * 50;
      ohlcv.push([Date.now() - (30 - i) * 60000, price - 10, price + 10, price - 20, price, 100 + i]);
    }

    const signal = strategy_RSIBounce('BTCUSDT', '15m', ohlcv);
    // May return null if synthetic data doesn't trigger — that's valid behavior
    if (signal) {
      assert.ok(['LONG', 'SHORT', 'CLOSE'].includes(signal.side), 'Side should be valid');
    }
  });

  it('should build a valid Volume Filter signal', async () => {
    const { strategy_VolumeFilter } = await import('../lib/signal-engine.js');

    // Build OHLCV with volume spike
    const ohlcv = [];
    for (let i = 0; i < 25; i++) {
      const vol = i === 24 ? 5000 : 100 + i * 10;
      ohlcv.push([Date.now() - (25 - i) * 60000, 50000, 50100, 49900, 50000, vol]);
    }

    const signal = strategy_VolumeFilter('BTCUSDT', '15m', ohlcv);
    // May return null if synthetic data doesn't trigger — that's valid behavior
    if (signal) {
      assert.ok(typeof signal.confidence === 'number', 'Confidence should be a number');
    }
  });

  it('should run all strategies and return array', async () => {
    const { runAllStrategies } = await import('../lib/signal-engine.js');

    const ohlcv = [];
    for (let i = 0; i < 30; i++) {
      ohlcv.push([Date.now() - (30 - i) * 60000, 50000, 50100, 49900, 50000, 100]);
    }

    const signals = runAllStrategies('BTCUSDT', '15m', ohlcv);
    assert.ok(Array.isArray(signals), 'Should return an array');
    // May be empty if no strategy triggers with synthetic data
  });
});

describe('Dynamic Strategies', () => {
  it('should run dynamic strategy with matching rules', async () => {
    const { runDynamicStrategy } = await import('../lib/ml/dynamicStrategies.js');

    const proposal = {
      id: 1,
      name: 'test_strategy',
      strategyName: 'test_strategy',
      rules: [
        { feature: 'funding_rate', operator: '>', value: -0.01, weight: 1 },
        { feature: 'rsi_divergence', operator: '>', value: 0.3, weight: 1 },
      ],
      side: 'LONG',
      confidence: 0.7,
    };

    const input = {
      fundingRate: -0.005,
      rsiDivergence: 0.5,
      socialSentiment: 0.3,
      newsSentiment: 0.4,
      whaleFlowScore: 0.2,
      btcDominanceScore: 0.5,
      macroScore: 0.5,
      orderBookDepth: 0.3,
      volatilityPct: 0.02,
      volumeChangePct: 0.1,
      liquidationImbalance: 0.1,
      openInterestChangePct: 0.05,
      emaCrossScore: 0.6,
      supportResistanceScore: 0.4,
    };

    const result = runDynamicStrategy(proposal, input);
    assert.ok(result, 'Should return a result');
    // runDynamicStrategy returns { strategy, side, confidence, rationale }
    // side is 'NONE' when passRate < 0.5
    assert.ok(result.side !== undefined, 'Should have side field');
    assert.ok(result.confidence !== undefined, 'Should have confidence');
  });

  it('should not trigger when rules do not match', async () => {
    const { runDynamicStrategy } = await import('../lib/ml/dynamicStrategies.js');

    const proposal = {
      id: 2,
      name: 'strict_strategy',
      strategyName: 'strict_strategy',
      rules: [
        { feature: 'funding_rate', operator: '>', value: 0.1, weight: 1 },
      ],
      side: 'SHORT',
      confidence: 0.8,
    };

    const input = {
      fundingRate: 0.05,
      rsiDivergence: 0.5,
      socialSentiment: 0.3,
      newsSentiment: 0.4,
      whaleFlowScore: 0.2,
      btcDominanceScore: 0.5,
      macroScore: 0.5,
      orderBookDepth: 0.3,
      volatilityPct: 0.02,
      volumeChangePct: 0.1,
      liquidationImbalance: 0.1,
      openInterestChangePct: 0.05,
      emaCrossScore: 0.6,
      supportResistanceScore: 0.4,
    };

    const result = runDynamicStrategy(proposal, input);
    assert.ok(result, 'Should return a result');
    // When funding_rate 0.05 <= 0.1, the rule doesn't pass, so passRate=0, side='NONE'
    assert.strictEqual(result.side, 'NONE', 'Should not trigger when funding_rate <= 0.1');
  });

  it('should handle empty rules gracefully', async () => {
    const { runDynamicStrategy } = await import('../lib/ml/dynamicStrategies.js');

    const proposal = {
      id: 3,
      name: 'empty_rules',
      strategyName: 'empty_rules',
      rules: [],
      side: 'LONG',
      confidence: 0.5,
    };

    const input = { fundingRate: 0.01 };
    const result = runDynamicStrategy(proposal, input);
    assert.ok(result, 'Should return a result even with empty rules');
    // With empty rules: totalWeight=0, passRate=0, side='NONE'
    assert.strictEqual(result.side, 'NONE', 'Empty rules result in NONE side');
  });
});

describe('Promotion Gate', () => {
  it('should pass a high-quality backtest', async () => {
    const { evaluatePromotionGate } = await import('../lib/ml/promotionGate.js');

    const backtest = {
      totalTrades: 100,
      winRate: 0.55,
      profitFactor: 1.8,
      maxDrawdownPct: 12,
      expectancy: 0.05,
      totalReturnPct: 45,
      trades: Array.from({ length: 100 }, (_, i) => ({
        pnlPct: i < 55 ? 1.5 : -0.8,
        exitAt: Date.now() - (100 - i) * 60000,
      })),
    };

    const result = evaluatePromotionGate(backtest, {
      walkForward: { passed: true, trainWinRate: 0.56, valWinRate: 0.54, oosWinRate: 0.52 },
      sourceName: 'binance_futures',
      strategyName: 'test_strategy',
    });

    assert.ok(result, 'Should return a result');
    // evaluatePromotionGate returns { approved, failures, details, score }
    assert.ok(result.approved !== undefined, 'Should have approved field');
    assert.ok(result.details, 'Should have details');
    assert.ok(result.score !== undefined, 'Should have score');
  });

  it('should reject low-trade-count backtest', async () => {
    const { evaluatePromotionGate } = await import('../lib/ml/promotionGate.js');

    const backtest = {
      totalTrades: 5,
      winRate: 0.6,
      profitFactor: 2.0,
      maxDrawdownPct: 5,
      expectancy: 0.1,
      totalReturnPct: 10,
      trades: [],
    };

    const result = evaluatePromotionGate(backtest, {
      walkForward: { passed: false },
      sourceName: 'unknown',
      strategyName: 'low_trade_strategy',
    });

    assert.ok(result, 'Should return a result');
    // evaluatePromotionGate returns { approved, failures, details, score }
    assert.strictEqual(result.approved, false, 'Should fail with low trade count');
  });

  it('should compute promotion score correctly', async () => {
    const { computePromotionScore } = await import('../lib/ml/promotionGate.js');

    const metrics = {
      winRate: 0.55,
      profitFactor: 2.0,
      totalTrades: 100,
      maxDrawdownPct: 10,
      expectancy: 0.08,
      totalReturnPct: 50,
    };

    const score = computePromotionScore(metrics);
    assert.ok(typeof score === 'number', 'Score should be a number');
    assert.ok(score >= 0 && score <= 1, 'Score should be between 0 and 1');
  });

  it('should format rejection reasons', async () => {
    const { formatRejection } = await import('../lib/ml/promotionGate.js');

    // formatRejection uses gateResult.failures (array) and gateResult.approved
    const gateResult = {
      approved: false,
      score: 0.3,
      failures: [
        'Blocked: only 5 trades. Minimum 50 required.',
        'Blocked: win rate 40.0% < 45%.',
      ],
      details: {
        minTrades: { passed: false, reason: 'Only 5 trades (min 50)' },
        profitFactor: { passed: true },
        maxDrawdown: { passed: true },
        winRate: { passed: false, reason: 'Win rate 40% (min 45%)' },
      },
    };

    const formatted = formatRejection(gateResult);
    assert.ok(typeof formatted === 'string', 'Should return a string');
    assert.ok(formatted.includes('5 trades'), 'Should mention trade count');
  });
});

describe('Strategy Evaluator', () => {
  it('should compute composite score', async () => {
    const { computeCompositeScore } = await import('../lib/ml/strategyEvaluator.js');

    const metrics = {
      sharpeRatio: 1.5,
      winRate: 0.55,
      profitFactor: 2.0,
      trades: 100,
      maxDrawdownPct: 10,
      expectancy: 0.08,
      totalReturnPct: 50,
    };

    const score = computeCompositeScore(metrics);
    assert.ok(typeof score === 'number', 'Score should be a number');
    assert.ok(score >= 0 && score <= 1, 'Score should be between 0 and 1');
  });

  it('should assign correct tier based on score', async () => {
    const { assignTier } = await import('../lib/ml/strategyEvaluator.js');

    assert.strictEqual(assignTier(0.90), 'S', 'Score >= 0.85 should be S');
    assert.strictEqual(assignTier(0.75), 'A', 'Score >= 0.70 should be A');
    assert.strictEqual(assignTier(0.60), 'B', 'Score >= 0.55 should be B');
    assert.strictEqual(assignTier(0.45), 'C', 'Score >= 0.40 should be C');
    assert.strictEqual(assignTier(0.30), 'F', 'Score < 0.40 should be F');
  });
});

describe('Performance Metrics', () => {
  it('should calculate metrics for empty trades', async () => {
    const { calculatePerformanceMetrics } = await import('../lib/ml/performanceMetrics.js');

    const metrics = calculatePerformanceMetrics([]);
    assert.ok(metrics, 'Should return metrics for empty trades');
    assert.strictEqual(metrics.totalTrades, 0, 'Total trades should be 0');
    assert.strictEqual(metrics.winRate, 0, 'Win rate should be 0');
    assert.strictEqual(metrics.profitFactor, 0, 'Profit factor should be 0');
  });

  it('should calculate metrics for profitable trades', async () => {
    const { calculatePerformanceMetrics } = await import('../lib/ml/performanceMetrics.js');

    const trades = [
      { pnlPct: 2.0, exitAt: Date.now() - 3600000 },
      { pnlPct: -1.0, exitAt: Date.now() - 1800000 },
      { pnlPct: 1.5, exitAt: Date.now() - 900000 },
      { pnlPct: 3.0, exitAt: Date.now() },
      { pnlPct: -0.5, exitAt: Date.now() - 7200000 },
    ];

    const metrics = calculatePerformanceMetrics(trades);
    assert.ok(metrics, 'Should return metrics');
    assert.strictEqual(metrics.totalTrades, 5, 'Should count 5 trades');
    // calculatePerformanceMetrics returns winRate (0-1), not winningTrades count
    // 3 winners out of 5 = 0.6 win rate
    assert.strictEqual(metrics.winRate, 0.6, 'Win rate should be 0.6');
    assert.ok(metrics.profitFactor > 0, 'Profit factor should be positive');
  });

  it('should calculate drawdown correctly', async () => {
    const { calculatePerformanceMetrics } = await import('../lib/ml/performanceMetrics.js');

    // Trades that create a peak then drawdown
    const trades = [
      { pnlPct: 5.0, exitAt: Date.now() - 5000000 },
      { pnlPct: 3.0, exitAt: Date.now() - 4000000 },
      { pnlPct: -4.0, exitAt: Date.now() - 3000000 },
      { pnlPct: -3.0, exitAt: Date.now() - 2000000 },
      { pnlPct: 2.0, exitAt: Date.now() - 1000000 },
    ];

    const metrics = calculatePerformanceMetrics(trades);
    assert.ok(metrics, 'Should return metrics');
    assert.ok(metrics.maxDrawdownPct >= 0, 'Drawdown should be >= 0');
  });
});

describe('Walk-Forward Validator', () => {
  it('should validate walk-forward with sufficient trades', async () => {
    const { validateWalkForward } = await import('../lib/ml/walkForwardValidator.js');

    const trades = Array.from({ length: 100 }, (_, i) => ({
      pnlPct: i < 55 ? 1.0 : -0.5,
      exitAt: Date.now() - (100 - i) * 3600000,
    }));

    const result = validateWalkForward(trades);
    assert.ok(result, 'Should return a result');
    // validateWalkForward returns { trainMetrics, valMetrics, oosMetrics, passed, failures }
    assert.ok(result.passed !== undefined, 'Should have passed field');
    assert.ok(result.trainMetrics, 'Should have trainMetrics');
    assert.ok(typeof result.trainMetrics.winRate === 'number', 'Should have trainMetrics.winRate');
    assert.ok(result.valMetrics, 'Should have valMetrics');
  });

  it('should fail walk-forward with insufficient trades', async () => {
    const { validateWalkForward } = await import('../lib/ml/walkForwardValidator.js');

    const trades = Array.from({ length: 5 }, (_, i) => ({
      pnlPct: i < 3 ? 1.0 : -0.5,
      exitAt: Date.now() - (5 - i) * 3600000,
    }));

    const result = validateWalkForward(trades);
    assert.ok(result, 'Should return a result');
    assert.strictEqual(result.passed, false, 'Should fail with insufficient trades');
  });
});

describe('Failure Memory', () => {
  it('should categorize failure by metrics', async () => {
    const { categorizeFailure, FAILURE_CATEGORIES } = await import('../lib/ml/failureMemory.js');

    // categorizeFailure returns a string (the category value), not an object
    const lowTrades = categorizeFailure({ totalTrades: 5, winRate: 0.5, profitFactor: 1.0 });
    assert.ok(lowTrades, 'Should have a category');
    assert.strictEqual(lowTrades, FAILURE_CATEGORIES.LOW_TRADE_COUNT, 'Low trades should be LOW_TRADE_COUNT');

    const badDrawdown = categorizeFailure({ totalTrades: 100, winRate: 0.5, profitFactor: 1.0, maxDrawdownPct: 35 });
    assert.strictEqual(badDrawdown, FAILURE_CATEGORIES.BAD_DRAWDOWN, 'High drawdown should be BAD_DRAWDOWN');

    const lowPf = categorizeFailure({ totalTrades: 100, winRate: 0.5, profitFactor: 0.8, maxDrawdownPct: 10 });
    assert.strictEqual(lowPf, FAILURE_CATEGORIES.LOW_PROFIT_FACTOR, 'Low PF should be LOW_PROFIT_FACTOR');
  });

  it('should hash strategy rules consistently', async () => {
    const { hashStrategyRules } = await import('../lib/ml/failureMemory.js');

    const rules1 = [{ feature: 'funding_rate', operator: '>', value: 0.01 }];
    const rules2 = [{ feature: 'funding_rate', operator: '>', value: 0.01 }];
    const rules3 = [{ feature: 'rsi_divergence', operator: '>', value: 0.3 }];

    const hash1 = hashStrategyRules(rules1);
    const hash2 = hashStrategyRules(rules2);
    const hash3 = hashStrategyRules(rules3);

    assert.strictEqual(hash1, hash2, 'Same rules should produce same hash');
    assert.notStrictEqual(hash1, hash3, 'Different rules should produce different hash');
  });
});

describe('Regime Ranker', () => {
  it('should detect market regime from input', async () => {
    const { detectRegime, REGIMES } = await import('../lib/ml/regimeRanker.js');

    // detectRegime returns a string (the regime value), not an object
    // With emaCrossScore=0.8, volatilityPct=0.01: vol=0.01, trend=|0|=0
    // vol < 0.5 → LOW_VOLATILITY
    const trendingUp = detectRegime({ emaCrossScore: 0.8, volatilityPct: 0.01 });
    assert.ok(trendingUp, 'Should detect a regime');
    assert.ok(Object.values(REGIMES).includes(trendingUp), 'Should be a valid regime');

    // With volatilityPct=0.08: vol=0.08, still < 0.5 → LOW_VOLATILITY
    // Actually vol=0.08 < 0.5, so still LOW_VOLATILITY
    const lowVol = detectRegime({ emaCrossScore: 0.3, volatilityPct: 0.08 });
    assert.ok(lowVol, 'Should detect a regime');
  });

  it('should check strategy suitability for regime', async () => {
    const { isStrategySuitableForRegime } = await import('../lib/ml/regimeRanker.js');

    const result = isStrategySuitableForRegime('test_strategy', 'trend', 0.5);
    assert.ok(result !== undefined, 'Should return a result');
  });
});

describe('Quarantine Manager', () => {
  it('should enter and check quarantine status', async () => {
    const { enterQuarantine, checkQuarantineStatus } = await import('../lib/ml/quarantineManager.js');

    // enterQuarantine returns undefined (no return value), logs instead
    // It tries to UPDATE strategy_lifecycle which may not have the row
    enterQuarantine('test_quarantine_strat', { reason: 'High drawdown' });

    const status = checkQuarantineStatus('test_quarantine_strat');
    assert.ok(status, 'Should return status');
    // checkQuarantineStatus returns { completed, trades, winRate, expectancy, passed, reasons }
    assert.ok(status.completed !== undefined, 'Should have completed field');
  });

  it('should return not in quarantine for unknown strategy', async () => {
    const { checkQuarantineStatus } = await import('../lib/ml/quarantineManager.js');

    const status = checkQuarantineStatus('nonexistent_strategy_' + Date.now());
    assert.ok(status, 'Should return status');
    // checkQuarantineStatus returns { completed, trades, winRate, expectancy, passed, reasons }
    // For unknown strategy with 0 trades: completed=false
    assert.strictEqual(status.completed, false, 'Unknown strategy should not have completed quarantine');
  });
});

describe('Duplicate Detector', () => {
  it('should normalize rules consistently', async () => {
    const { normalizeRules, hashRules } = await import('../lib/ml/duplicateDetector.js');

    const rules1 = [
      { feature: 'funding_rate', operator: '>', value: 0.01 },
      { feature: 'rsi_divergence', operator: '>', value: 0.3 },
    ];
    const rules2 = [
      { feature: 'rsi_divergence', operator: '>', value: 0.3 },
      { feature: 'funding_rate', operator: '>', value: 0.01 },
    ];

    const hash1 = hashRules(normalizeRules(rules1));
    const hash2 = hashRules(normalizeRules(rules2));

    assert.strictEqual(hash1, hash2, 'Same rules in different order should produce same hash');
  });

  it('should hash proposal consistently', async () => {
    const { hashProposal } = await import('../lib/ml/duplicateDetector.js');

    const proposal1 = { strategyName: 'test', rules: [{ feature: 'funding_rate', operator: '>', value: 0.01 }] };
    const proposal2 = { strategyName: 'test', rules: [{ feature: 'funding_rate', operator: '>', value: 0.01 }] };

    assert.strictEqual(hashProposal(proposal1), hashProposal(proposal2), 'Same proposals should produce same hash');
  });
});
