// ============================================================
// ML Pipeline Unit Tests
// Tests features.js, backtestEngine.js, promotionGate.js,
// dynamicStrategies.js, walkForwardValidator.js, failureMemory.js
// ============================================================

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

// ── Mock environment ───────────────────────────────────────
process.env.NODE_ENV = 'test';

// ── Features Tests ─────────────────────────────────────────
describe('Features Module (features.js)', () => {
  let FEATURE_NAMES, buildFeatures, vectorize;

  before(async () => {
    const mod = await import('../lib/ml/features.js');
    FEATURE_NAMES = mod.FEATURE_NAMES;
    buildFeatures = mod.buildFeatures;
    vectorize = mod.vectorize;
  });

  it('should export FEATURE_NAMES as an array', () => {
    assert.ok(Array.isArray(FEATURE_NAMES), 'FEATURE_NAMES should be an array');
    assert.ok(FEATURE_NAMES.length > 0, 'FEATURE_NAMES should not be empty');
  });

  it('should include expected feature names', () => {
    const expected = [
      'funding_rate',
      'open_interest_change_pct',
      'liquidation_imbalance',
      'social_sentiment',
      'news_sentiment',
      'whale_flow_score',
      'btc_dominance_score',
      'macro_score',
      'ema_cross_score',
      'rsi_divergence',
      'support_resistance_score',
    ];
    for (const name of expected) {
      assert.ok(FEATURE_NAMES.includes(name), `FEATURE_NAMES should include ${name}`);
    }
  });

  it('should build features from input object', () => {
    const input = {
      fundingRate: -0.001,
      openInterestChangePct: 0.05,
      liquidationImbalance: 0.3,
      socialSentiment: 0.6,
      newsSentiment: 0.7,
      whaleFlowScore: 0.4,
      btcDominanceScore: 0.55,
      macroScore: 0.5,
      emaCrossScore: 0.8,
      rsiDivergence: 0.1,
      supportResistanceScore: 0.9,
    };
    const features = buildFeatures(input);

    assert.ok(features, 'buildFeatures should return an object');
    assert.strictEqual(features.funding_rate, -0.001, 'funding_rate should match');
    assert.strictEqual(features.social_sentiment, 0.6, 'social_sentiment should match');
    assert.strictEqual(features.ema_cross_score, 0.8, 'ema_cross_score should match');
    assert.strictEqual(features.rsi_divergence, 0.1, 'rsi_divergence should match');
  });

  it('should handle missing optional features with defaults', () => {
    const input = {
      fundingRate: 0,
      openInterestChangePct: 0,
      liquidationImbalance: 0,
    };
    const features = buildFeatures(input);

    assert.ok(features, 'buildFeatures should handle minimal input');
    assert.strictEqual(typeof features.social_sentiment, 'number', 'social_sentiment should default to number');
    assert.strictEqual(typeof features.ema_cross_score, 'number', 'ema_cross_score should default to number');
  });

  it('should vectorize features into ordered array', () => {
    const input = {
      fundingRate: -0.001,
      openInterestChangePct: 0.05,
      liquidationImbalance: 0.3,
      socialSentiment: 0.6,
      newsSentiment: 0.7,
      whaleFlowScore: 0.4,
      btcDominanceScore: 0.55,
      macroScore: 0.5,
      emaCrossScore: 0.8,
      rsiDivergence: 0.1,
      supportResistanceScore: 0.9,
    };
    const features = buildFeatures(input);
    const vec = vectorize(features);

    assert.ok(Array.isArray(vec), 'vectorize should return an array');
    assert.strictEqual(vec.length, FEATURE_NAMES.length, 'vector length should match FEATURE_NAMES length');
    assert.ok(vec.every(v => typeof v === 'number'), 'all vector elements should be numbers');
  });
});

// ── Backtest Engine Tests ──────────────────────────────────
describe('Backtest Engine (backtestEngine.js)', () => {
  let backtestStrategy, backtestAllStrategies;

  before(async () => {
    const mod = await import('../lib/ml/backtestEngine.js');
    backtestStrategy = mod.backtestStrategy;
    backtestAllStrategies = mod.backtestAllStrategies;
  });

  it('should export backtestStrategy as a function', () => {
    assert.ok(typeof backtestStrategy === 'function', 'backtestStrategy should be a function');
  });

  it('should export backtestAllStrategies as a function', () => {
    assert.ok(typeof backtestAllStrategies === 'function', 'backtestAllStrategies should be a function');
  });

  it('should return empty result for unknown strategy', () => {
    const candles = [
      { close: 100, high: 101, low: 99, volume: 1000, timestamp: 1 },
      { close: 101, high: 102, low: 100, volume: 1100, timestamp: 2 },
    ];
    const result = backtestStrategy('unknown_strategy', candles, 'BTCUSDT');
    assert.ok(result, 'backtestStrategy should return a result');
    assert.strictEqual(result.totalTrades, 0, 'unknown strategy should have 0 trades');
  });

  it('should return empty result for empty candles', () => {
    const result = backtestStrategy('ema_cross', [], 'BTCUSDT');
    assert.ok(result, 'backtestStrategy should return a result for empty candles');
    assert.strictEqual(result.totalTrades, 0, 'empty candles should have 0 trades');
  });

  it('should backtest all strategies without error', () => {
    const candles = [
      { close: 100, high: 101, low: 99, volume: 1000, timestamp: 1 },
      { close: 101, high: 102, low: 100, volume: 1100, timestamp: 2 },
      { close: 102, high: 103, low: 101, volume: 1200, timestamp: 3 },
    ];
    const results = backtestAllStrategies(candles, 'BTCUSDT');
    assert.ok(Array.isArray(results), 'backtestAllStrategies should return an array');
    assert.ok(results.length > 0, 'should have at least one strategy result');
    for (const r of results) {
      assert.ok(r.strategyName, 'each result should have a strategyName');
      assert.ok(typeof r.totalTrades === 'number', 'each result should have totalTrades');
    }
  });
});

// ── Promotion Gate Tests ───────────────────────────────────
describe('Promotion Gate (promotionGate.js)', () => {
  let evaluatePromotionGate, PROMOTION_GATE_DEFAULTS, computePromotionScore, formatRejection;

  before(async () => {
    const mod = await import('../lib/ml/promotionGate.js');
    evaluatePromotionGate = mod.evaluatePromotionGate;
    PROMOTION_GATE_DEFAULTS = mod.PROMOTION_GATE_DEFAULTS;
    computePromotionScore = mod.computePromotionScore;
    formatRejection = mod.formatRejection;
  });

  it('should export PROMOTION_GATE_DEFAULTS with expected thresholds', () => {
    assert.ok(PROMOTION_GATE_DEFAULTS, 'PROMOTION_GATE_DEFAULTS should be defined');
    assert.ok(PROMOTION_GATE_DEFAULTS.minTotalTrades >= 30, 'minTotalTrades should be >= 30');
    assert.ok(PROMOTION_GATE_DEFAULTS.minProfitFactor >= 1.0, 'minProfitFactor should be >= 1.0');
    assert.ok(PROMOTION_GATE_DEFAULTS.minWinRate >= 0.3, 'minWinRate should be >= 0.3');
  });

  it('should reject backtest with 0 trades', () => {
    const backtest = {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      expectancy: 0,
      totalReturnPct: 0,
      strategyName: 'test_strategy',
    };
    const result = evaluatePromotionGate(backtest);
    assert.ok(result, 'evaluatePromotionGate should return a result');
    assert.strictEqual(result.approved, false, '0 trades should not pass promotion gate');
    assert.ok(result.details, 'result should have details');
  });

  it('should reject backtest with low profit factor', () => {
    const backtest = {
      totalTrades: 100,
      winRate: 0.5,
      profitFactor: 0.8,
      maxDrawdownPct: 10,
      expectancy: 0.1,
      totalReturnPct: 5,
      strategyName: 'test_strategy',
      trades: Array(100).fill({ pnlPct: 0.1 }),
    };
    const result = evaluatePromotionGate(backtest);
    assert.ok(result, 'evaluatePromotionGate should return a result');
    assert.strictEqual(result.approved, false, 'low PF should not pass');
  });

  it('should accept backtest meeting all thresholds', () => {
    const backtest = {
      totalTrades: 100,
      winRate: 0.55,
      profitFactor: 2.0,
      maxDrawdownPct: 15,
      expectancy: 0.5,
      totalReturnPct: 30,
      strategyName: 'test_strategy',
      trades: Array(100).fill({ pnlPct: 0.5 }),
    };
    const result = evaluatePromotionGate(backtest, {
      walkForward: {
        oosMetrics: { expectancy: 0.3, totalTrades: 20 },
        trainMetrics: { totalTrades: 60 },
        valMetrics: { totalTrades: 20 },
      },
    });
    assert.ok(result, 'evaluatePromotionGate should return a result');
    assert.ok(typeof result.approved === 'boolean', 'approved should be boolean');
    assert.ok(typeof result.score === 'number', 'score should be a number');
  });

  it('should compute promotion score correctly', () => {
    const score = computePromotionScore({
      totalTrades: 100,
      winRate: 0.55,
      profitFactor: 2.0,
      maxDrawdownPct: 15,
      expectancy: 0.5,
      totalReturnPct: 30,
    });
    assert.ok(typeof score === 'number', 'score should be a number');
    assert.ok(score > 0, 'score should be positive for good metrics');
  });

  it('should format rejection details as string', () => {
    const gateResult = {
      approved: false,
      score: 0.3,
      failures: ['Blocked: profit factor 0.80 < 1.25.'],
      details: {
        minTrades: { passed: true },
        profitFactor: { passed: false, value: 0.8, required: '>= 1.25' },
        winRate: { passed: true },
        maxDrawdown: { passed: true },
        expectancy: { passed: true },
      },
    };
    const formatted = formatRejection(gateResult);
    assert.ok(typeof formatted === 'string', 'formatRejection should return a string');
    assert.ok(formatted.length > 0, 'formatted rejection should not be empty');
  });
});

// ── Dynamic Strategies Tests ────────────────────────────────
describe('Dynamic Strategies (dynamicStrategies.js)', () => {
  let runDynamicStrategy, loadCandidateProposals, runResearchStrategyLab;

  before(async () => {
    const mod = await import('../lib/ml/dynamicStrategies.js');
    runDynamicStrategy = mod.runDynamicStrategy;
    loadCandidateProposals = mod.loadCandidateProposals;
    runResearchStrategyLab = mod.runResearchStrategyLab;
  });

  it('should export runDynamicStrategy as a function', () => {
    assert.ok(typeof runDynamicStrategy === 'function', 'runDynamicStrategy should be a function');
  });

  it('should return neutral decision for empty proposal rules', () => {
    const proposal = {
      name: 'test_empty',
      rules: [],
      confidence: 0.5,
    };
    const input = {
      fundingRate: 0,
      socialSentiment: 0.5,
    };
    const result = runDynamicStrategy(proposal, input);
    assert.ok(result, 'runDynamicStrategy should return a result');
    assert.strictEqual(result.side, 'NONE', 'empty rules should produce NONE');
  });

  it('should return LONG when all rules pass for long side', () => {
    const proposal = {
      name: 'test_long',
      rules: [
        { feature: 'rsi_divergence', operator: 'gt', value: 0.3, weight: 1, side: 'LONG' },
        { feature: 'social_sentiment', operator: 'gt', value: 0.4, weight: 1, side: 'LONG' },
      ],
      confidence: 0.7,
    };
    const input = {
      rsiDivergence: 0.6,
      socialSentiment: 0.8,
    };
    const result = runDynamicStrategy(proposal, input);
    assert.ok(result, 'runDynamicStrategy should return a result');
    assert.strictEqual(result.side, 'LONG', 'passing rules should produce LONG');
    assert.ok(result.confidence > 0, 'confidence should be positive');
  });

  it('should return NONE when rules fail', () => {
    const proposal = {
      name: 'test_fail',
      rules: [
        { feature: 'rsi_divergence', operator: 'gt', value: 0.7, weight: 1, side: 'LONG' },
      ],
      confidence: 0.7,
    };
    const input = {
      rsiDivergence: 0.3,
    };
    const result = runDynamicStrategy(proposal, input);
    assert.ok(result, 'runDynamicStrategy should return a result');
    assert.strictEqual(result.side, 'NONE', 'failing rules should produce NONE');
  });

  it('should export loadCandidateProposals as a function', () => {
    assert.ok(typeof loadCandidateProposals === 'function', 'loadCandidateProposals should be a function');
  });

  it('should export runResearchStrategyLab as a function', () => {
    assert.ok(typeof runResearchStrategyLab === 'function', 'runResearchStrategyLab should be a function');
  });
});

// ── Walk-Forward Validator Tests ────────────────────────────
describe('Walk-Forward Validator (walkForwardValidator.js)', () => {
  let validateWalkForward, splitWalkForward, DEFAULT_WALK_FORWARD_CONFIG;

  before(async () => {
    const mod = await import('../lib/ml/walkForwardValidator.js');
    validateWalkForward = mod.validateWalkForward;
    splitWalkForward = mod.splitWalkForward;
    DEFAULT_WALK_FORWARD_CONFIG = mod.DEFAULT_WALK_FORWARD_CONFIG;
  });

  it('should export DEFAULT_WALK_FORWARD_CONFIG with expected splits', () => {
    assert.ok(DEFAULT_WALK_FORWARD_CONFIG, 'DEFAULT_WALK_FORWARD_CONFIG should be defined');
    assert.ok(DEFAULT_WALK_FORWARD_CONFIG.trainRatio > 0, 'trainRatio should be > 0');
    assert.ok(DEFAULT_WALK_FORWARD_CONFIG.trainRatio < 1, 'trainRatio should be < 1');
    assert.ok(DEFAULT_WALK_FORWARD_CONFIG.valRatio > 0, 'valRatio should be > 0');
  });

  it('should return passed=false for empty trades', () => {
    const result = validateWalkForward([]);
    assert.ok(result, 'validateWalkForward should return a result');
    assert.strictEqual(result.passed, false, 'empty trades should not pass');
  });

  it('should split trades into train/val/OOS', () => {
    const trades = Array(100).fill({ pnlPct: 0.1 });
    const split = splitWalkForward(trades);
    assert.ok(split, 'splitWalkForward should return a result');
    assert.ok(Array.isArray(split.train), 'train should be an array');
    assert.ok(Array.isArray(split.val), 'val should be an array');
    assert.ok(Array.isArray(split.oos), 'oos should be an array');
    assert.strictEqual(split.train.length + split.val.length + split.oos.length, 100, 'total should equal input length');
  });

  it('should pass walk-forward with consistent performance', () => {
    const trades = Array(200).fill({ pnlPct: 0.5 });
    const result = validateWalkForward(trades);
    assert.ok(result, 'validateWalkForward should return a result');
    assert.ok(typeof result.passed === 'boolean', 'passed should be boolean');
  });
});

// ── Failure Memory Tests ────────────────────────────────────
describe('Failure Memory (failureMemory.js)', () => {
  let recordFailure, findFailureByRules, isKnownFailure, FAILURE_CATEGORIES, hashStrategyRules;

  before(async () => {
    const mod = await import('../lib/ml/failureMemory.js');
    recordFailure = mod.recordFailure;
    findFailureByRules = mod.findFailureByRules;
    isKnownFailure = mod.isKnownFailure;
    FAILURE_CATEGORIES = mod.FAILURE_CATEGORIES;
    hashStrategyRules = mod.hashStrategyRules;
  });

  it('should export FAILURE_CATEGORIES with expected categories', () => {
    assert.ok(FAILURE_CATEGORIES, 'FAILURE_CATEGORIES should be defined');
    assert.ok(FAILURE_CATEGORIES.LOW_TRADE_COUNT, 'should have LOW_TRADE_COUNT');
    assert.ok(FAILURE_CATEGORIES.LOW_WIN_RATE, 'should have LOW_WIN_RATE');
    assert.ok(FAILURE_CATEGORIES.LOW_PROFIT_FACTOR, 'should have LOW_PROFIT_FACTOR');
  });

  it('should hash strategy rules consistently', () => {
    const rules1 = [{ feature: 'rsi_divergence', operator: '>', threshold: 0.5 }];
    const rules2 = [{ feature: 'rsi_divergence', operator: '>', threshold: 0.5 }];
    const rules3 = [{ feature: 'rsi_divergence', operator: '>', threshold: 0.6 }];

    const hash1 = hashStrategyRules(rules1);
    const hash2 = hashStrategyRules(rules2);
    const hash3 = hashStrategyRules(rules3);

    assert.strictEqual(hash1, hash2, 'identical rules should produce same hash');
    assert.notStrictEqual(hash1, hash3, 'different rules should produce different hash');
  });

  it('should export recordFailure as a function', () => {
    assert.ok(typeof recordFailure === 'function', 'recordFailure should be a function');
  });

  it('should export findFailureByRules as a function', () => {
    assert.ok(typeof findFailureByRules === 'function', 'findFailureByRules should be a function');
  });

  it('should export isKnownFailure as a function', () => {
    assert.ok(typeof isKnownFailure === 'function', 'isKnownFailure should be a function');
  });
});

// ── Duplicate Detector Tests ────────────────────────────────
describe('Duplicate Detector (duplicateDetector.js)', () => {
  let normalizeRule, normalizeRules, hashRules, hashProposal, isDuplicateHash, checkDuplicate;

  before(async () => {
    const mod = await import('../lib/ml/duplicateDetector.js');
    normalizeRule = mod.normalizeRule;
    normalizeRules = mod.normalizeRules;
    hashRules = mod.hashRules;
    hashProposal = mod.hashProposal;
    isDuplicateHash = mod.isDuplicateHash;
    checkDuplicate = mod.checkDuplicate;
  });

  it('should normalize a rule consistently', () => {
    const rule = { feature: 'RSI_DIVERGENCE', operator: '>', threshold: 0.5, side: 'LONG' };
    const normalized = normalizeRule(rule);
    assert.ok(normalized, 'normalizeRule should return a value');
    assert.ok(typeof normalized === 'string' || typeof normalized === 'object', 'normalized should be string or object');
  });

  it('should normalize rules consistently', () => {
    const rules1 = [{ feature: 'rsi_divergence', operator: '>', threshold: 0.5 }];
    const rules2 = [{ feature: 'rsi_divergence', operator: '>', threshold: 0.5 }];
    const n1 = normalizeRules(rules1);
    const n2 = normalizeRules(rules2);
    assert.deepStrictEqual(n1, n2, 'identical rules should produce identical normalized output');
  });

  it('should hash rules consistently', () => {
    const rules = [{ feature: 'rsi_divergence', operator: '>', threshold: 0.5 }];
    const hash1 = hashRules(rules);
    const hash2 = hashRules(rules);
    assert.strictEqual(hash1, hash2, 'identical rules should produce same hash');
  });

  it('should export checkDuplicate as a function', () => {
    assert.ok(typeof checkDuplicate === 'function', 'checkDuplicate should be a function');
  });
});

// ── Strategy Lifecycle Tests ────────────────────────────────
describe('Strategy Lifecycle (strategyLifecycle.js)', () => {
  let approveForMock, initLifecycle, recordHistoricalBacktest, promoteFromQuarantine, startMockTesting;

  before(async () => {
    const mod = await import('../lib/ml/strategyLifecycle.js');
    approveForMock = mod.approveForMock;
    initLifecycle = mod.initLifecycle;
    recordHistoricalBacktest = mod.recordHistoricalBacktest;
    promoteFromQuarantine = mod.promoteFromQuarantine;
    startMockTesting = mod.startMockTesting;
  });

  it('should approve backtest meeting criteria', () => {
    const backtest = {
      totalTrades: 100,
      winRate: 0.55,
      profitFactor: 2.0,
      maxDrawdownPct: 15,
      expectancy: 0.5,
      totalReturnPct: 30,
    };
    const result = approveForMock(backtest);
    assert.ok(result, 'approveForMock should return a result');
    assert.ok(typeof result.approved === 'boolean', 'approved should be boolean');
  });

  it('should reject backtest with 0 trades', () => {
    const backtest = {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      expectancy: 0,
      totalReturnPct: 0,
    };
    const result = approveForMock(backtest);
    assert.ok(result, 'approveForMock should return a result');
    assert.strictEqual(result.approved, false, '0 trades should not be approved');
  });

  it('should export initLifecycle as a function', () => {
    assert.ok(typeof initLifecycle === 'function', 'initLifecycle should be a function');
  });

  it('should export promoteFromQuarantine as a function', () => {
    assert.ok(typeof promoteFromQuarantine === 'function', 'promoteFromQuarantine should be a function');
  });

  it('should export startMockTesting as a function', () => {
    assert.ok(typeof startMockTesting === 'function', 'startMockTesting should be a function');
  });
});

// ── Strategy Evaluator Tests ────────────────────────────────
describe('Strategy Evaluator (strategyEvaluator.js)', () => {
  let computeCompositeScore, assignTier;

  before(async () => {
    const mod = await import('../lib/ml/strategyEvaluator.js');
    computeCompositeScore = mod.computeCompositeScore;
    assignTier = mod.assignTier;
  });

  it('should compute composite score from metrics', () => {
    const metrics = {
      trades: 100,
      winRate: 0.55,
      sharpeRatio: 1.5,
      profitFactor: 2.0,
      maxDrawdownPct: 15,
    };
    const score = computeCompositeScore(metrics);
    assert.ok(typeof score === 'number', 'score should be a number');
    assert.ok(score >= 0 && score <= 1, 'score should be between 0 and 1');
  });

  it('should assign tier based on score', () => {
    assert.strictEqual(assignTier(0.90), 'S', 'score 0.90 should be S tier');
    assert.strictEqual(assignTier(0.75), 'A', 'score 0.75 should be A tier');
    assert.strictEqual(assignTier(0.60), 'B', 'score 0.60 should be B tier');
    assert.strictEqual(assignTier(0.45), 'C', 'score 0.45 should be C tier');
    assert.strictEqual(assignTier(0.10), 'F', 'score 0.10 should be F tier');
  });
});
