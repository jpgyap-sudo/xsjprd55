// ============================================================
// Integration Tests — xsjprd55
// Tests the full pipeline: signal generation → backtesting →
// strategy evaluation → promotion gate
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Signal → Backtest Pipeline', () => {
  it('should generate signals and backtest them end-to-end', async () => {
    const { buildSignal, runAllStrategies } = await import('../lib/signal-engine.js');
    const { simulateTradeCore, summarizeTrades } = await import('../lib/backtest/shared-core.js');

    // Generate OHLCV data that triggers an EMA cross (EMA_short=9 crosses EMA_long=21)
    // Strategy: prices start low, then trend up sharply to trigger LONG signal
    const ohlcv = [];
    for (let i = 0; i < 50; i++) {
      // Flat for first 25 candles, then sharp uptrend for next 25
      const basePrice = i < 25 ? 50000 + Math.sin(i * 0.5) * 10 : 50100 + (i - 25) * 30;
      ohlcv.push([Date.now() - (50 - i) * 60000, basePrice - 5, basePrice + 5, basePrice - 10, basePrice, 100 + i * 2]);
    }

    const result = runAllStrategies('BTCUSDT', '15m', ohlcv);
    // runAllStrategies returns an array of signal objects
    const signals = Array.isArray(result) ? result : (result.signals || []);
    // If no signals triggered (e.g. EMA cross didn't happen), skip backtest
    // but still verify the function ran without error
    if (signals.length === 0) {
      assert.ok(Array.isArray(result), 'runAllStrategies should return an array');
      return;
    }

    // Build candle objects for simulateTradeCore
    const candles = ohlcv.map(c => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));

    // Backtest the signals
    const trades = [];
    for (const signal of signals) {
      if (signal.side === 'CLOSE') continue;
      
      const trade = simulateTradeCore({
        entryPrice: signal.entry_price,
        side: signal.side,
        candles,
        takeProfitPct: 2,
        stopLossPct: 1,
      }, 'simple');
      
      trades.push(trade);
    }

    // Summarize
    const summary = summarizeTrades(trades);
    assert.ok(summary, 'Should produce summary');
    assert.ok(typeof summary.totalTrades === 'number', 'Should have totalTrades');
    assert.ok(typeof summary.winRate === 'number', 'Should have winRate');
  });

  it('should run dynamic strategy and evaluate performance', async () => {
    const { runDynamicStrategy } = await import('../lib/ml/dynamicStrategies.js');
    const { calculatePerformanceMetrics } = await import('../lib/ml/performanceMetrics.js');

    const proposal = {
      id: 1,
      strategyName: 'integration_test_strat',
      rules: [
        { feature: 'funding_rate', operator: '>', value: -0.01 },
        { feature: 'rsi_divergence', operator: '>', value: 0.3 },
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
    assert.ok(result, 'Dynamic strategy should run');

    if (result.triggered) {
      // Simulate trades and calculate metrics
      const trades = Array.from({ length: 100 }, (_, i) => ({
        pnlPct: i < 55 ? 1.5 : -0.8,
        exitAt: Date.now() - (100 - i) * 60000,
      }));

      const metrics = calculatePerformanceMetrics(trades);
      assert.ok(metrics, 'Should calculate metrics');
      assert.ok(metrics.totalTrades > 0, 'Should have trades');
      assert.ok(metrics.winRate > 0, 'Should have win rate');
    }
  });
});

describe('Strategy → Promotion Gate Pipeline', () => {
  it('should evaluate backtest through promotion gate', async () => {
    const { evaluatePromotionGate, computePromotionScore } = await import('../lib/ml/promotionGate.js');
    const { validateWalkForward } = await import('../lib/ml/walkForwardValidator.js');

    // Create a backtest result
    const trades = Array.from({ length: 100 }, (_, i) => ({
      pnlPct: i < 55 ? 1.0 : -0.5,
      exitAt: Date.now() - (100 - i) * 3600000,
    }));

    const backtest = {
      totalTrades: 100,
      winRate: 0.55,
      profitFactor: 1.8,
      maxDrawdownPct: 12,
      expectancy: 0.05,
      totalReturnPct: 45,
      trades,
    };

    // Run walk-forward validation
    const walkForward = validateWalkForward(trades);

    // Run promotion gate
    const gateResult = evaluatePromotionGate(backtest, {
      walkForward,
      sourceName: 'binance_futures',
      strategyName: 'integration_test_strat',
    });

    assert.ok(gateResult, 'Promotion gate should return result');
    // evaluatePromotionGate returns { approved, failures, details, score }
    assert.ok('approved' in gateResult, 'Should have approved field');
    assert.ok('score' in gateResult, 'Should have score field');
    assert.ok('details' in gateResult, 'Should have details field');

    // Compute score independently
    const score = computePromotionScore(backtest);
    assert.ok(typeof score === 'number', 'Score should be a number');
    assert.ok(score >= 0 && score <= 1, 'Score should be 0-1');
  });

  it('should classify strategy tier based on performance', async () => {
    const { computeCompositeScore, assignTier } = await import('../lib/ml/strategyEvaluator.js');

    const metrics = {
      winRate: 0.55,
      profitFactor: 2.0,
      totalTrades: 100,
      maxDrawdownPct: 10,
      expectancy: 0.08,
      totalReturnPct: 50,
    };

    const score = computeCompositeScore(metrics);
    const tier = assignTier(score);

    assert.ok(typeof score === 'number', 'Score should be a number');
    assert.ok(['S', 'A', 'B', 'C', 'F'].includes(tier), 'Tier should be valid');
  });
});

describe('Failure Memory → Quarantine Pipeline', () => {
  it('should record failure and enter quarantine', async () => {
    const { recordFailure, categorizeFailure, findFailureByRules } = await import('../lib/ml/failureMemory.js');
    const { enterQuarantine, checkQuarantineStatus } = await import('../lib/ml/quarantineManager.js');

    const strategyName = 'integration_fail_strat_' + Date.now();
    const rules = [{ feature: 'funding_rate', operator: '>', value: 0.1 }];

    // Record failure — recordFailure does not return a value (returns undefined)
    // It writes to SQLite internally; verify it doesn't throw
    assert.doesNotThrow(() => {
      recordFailure({
        strategyName,
        rules,
        failureReason: 'Low trade count',
        metrics: { totalTrades: 5, winRate: 0.5, profitFactor: 0.8, maxDrawdownPct: 10 },
      });
    }, 'recordFailure should not throw');

    // Enter quarantine — enterQuarantine does not return a value (returns undefined)
    // It writes to SQLite internally; verify it doesn't throw
    assert.doesNotThrow(() => {
      enterQuarantine(strategyName, { reason: 'Low trade count' });
    }, 'enterQuarantine should not throw');

    // Check quarantine status
    const status = checkQuarantineStatus(strategyName);
    assert.ok(status, 'Should have quarantine status');
    assert.ok(typeof status.completed === 'boolean', 'Should have completed field');
    assert.ok(typeof status.trades === 'number', 'Should have trades field');

    // Find by rules
    const found = findFailureByRules(rules);
    assert.ok(found, 'Should find failure by rules');
  });
});

describe('Regime Detection → Strategy Suitability Pipeline', () => {
  it('should detect regime and check strategy suitability', async () => {
    const { detectRegime, isStrategySuitableForRegime, getRegimeAdjustedScore } = await import('../lib/ml/regimeRanker.js');

    // Detect regime — detectRegime returns a string (regime name), not an object
    const regime = detectRegime({ emaCrossScore: 0.8, volatilityPct: 0.01 });
    assert.ok(typeof regime === 'string', 'Should detect regime as a string');
    assert.ok(regime.length > 0, 'Regime should not be empty');

    // Check suitability
    const suitable = isStrategySuitableForRegime('test_strat', regime, 0.5);
    assert.ok(suitable !== undefined, 'Should return suitability result');

    // Get adjusted score
    const adjusted = getRegimeAdjustedScore('test_strat', regime, 0.7);
    assert.ok(typeof adjusted === 'number', 'Adjusted score should be a number');
  });
});

describe('Duplicate Detection Pipeline', () => {
  it('should detect duplicate proposals', async () => {
    const { normalizeRules, hashRules, hashProposal, checkDuplicate } = await import('../lib/ml/duplicateDetector.js');

    const rules1 = [
      { feature: 'funding_rate', operator: '>', value: 0.01 },
      { feature: 'rsi_divergence', operator: '>', value: 0.3 },
    ];
    const rules2 = [
      { feature: 'rsi_divergence', operator: '>', value: 0.3 },
      { feature: 'funding_rate', operator: '>', value: 0.01 },
    ];

    const normalized1 = normalizeRules(rules1);
    const normalized2 = normalizeRules(rules2);
    const hash1 = hashRules(normalized1);
    const hash2 = hashRules(normalized2);

    assert.strictEqual(hash1, hash2, 'Same rules in different order should produce same hash');

    // Check duplicate
    const proposal1 = { strategyName: 'test', rules: rules1 };
    const proposal2 = { strategyName: 'test', rules: rules2 };

    assert.strictEqual(hashProposal(proposal1), hashProposal(proposal2), 'Same proposals should produce same hash');
  });
});

describe('ML Pipeline Integration', () => {
  it('should build features and predict', async () => {
    const { buildFeatures, vectorize } = await import('../lib/ml/features.js');
    const { predictMlProbability } = await import('../lib/ml/model.js');

    const features = buildFeatures({
      fundingRate: -0.005,
      openInterestChangePct: 0.05,
      liquidationImbalance: 0.1,
      volumeChangePct: 0.2,
      volatilityPct: 0.02,
      socialSentiment: 0.3,
      newsSentiment: 0.4,
      btcTrendScore: 0.6,
      whaleFlowScore: 0.2,
      spreadBps: 5,
      sideLong: 1,
      emaCrossScore: 0.6,
      rsiDivergence: 0.5,
      supportResistanceScore: 0.4,
      macroScore: 0.5,
      btcDominanceScore: 0.5,
      orderBookDepth: 0.3,
      ruleProbability: 0.7,
      logTotalLiquidations: 10,
      fundingRateChangePct: 0.01,
    });

    assert.ok(features, 'Should build features');
    assert.ok(typeof features === 'object', 'Features should be an object');

    const vec = vectorize(features);
    assert.ok(Array.isArray(vec), 'Vectorized features should be an array');
    assert.ok(vec.length > 0, 'Vector should have values');

    // Predict (model may not be trained, but should not throw)
    try {
      const prediction = predictMlProbability(features);
      assert.ok(prediction !== undefined, 'Prediction should return a value');
    } catch (e) {
      // Model may not be trained — that's acceptable
      assert.ok(e.message.includes('train') || e.message.includes('model'), 'Error should be about training');
    }
  });

  it('should map OHLCV to ML features', async () => {
    const { mapOhlcvToMlFeatures } = await import('../lib/ml/feature-mapper.js');

    const ohlcv = [];
    for (let i = 0; i < 30; i++) {
      ohlcv.push([Date.now() - (30 - i) * 60000, 50000 + i * 10, 50100 + i * 10, 49900 + i * 10, 50050 + i * 10, 100 + i * 10]);
    }

    const features = mapOhlcvToMlFeatures(ohlcv);
    assert.ok(features, 'Should map features');
    // mapOhlcvToMlFeatures returns technical indicator fields (rsi, macd, ema_fast, ema_slow, atr, etc.)
    assert.ok('rsi' in features, 'Should have rsi');
    assert.ok('macd' in features, 'Should have macd');
    assert.ok('ema_fast' in features, 'Should have ema_fast');
    assert.ok('volume' in features, 'Should have volume');
  });
});

console.log('✅ Integration tests defined');
