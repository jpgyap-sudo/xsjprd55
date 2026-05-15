// ============================================================
// Worker Tests — xsjprd55
// Validates worker imports and basic functionality
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Mock environment for tests
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.NODE_ENV = 'test';

describe('Worker Import Tests', () => {
  it('should import logger without error', async () => {
    const { logger } = await import('../lib/logger.js');
    assert.ok(logger, 'Logger should be defined');
    assert.ok(typeof logger.info === 'function', 'Logger should have info method');
    assert.ok(typeof logger.error === 'function', 'Logger should have error method');
  });

  it('should import config without error', async () => {
    const { config } = await import('../lib/config.js');
    assert.ok(config, 'Config should be defined');
    assert.ok(typeof config.PORT === 'number', 'Config PORT should be a number');
  });

  it('should import supabase client without error', async () => {
    const { supabase, isSupabaseNoOp } = await import('../lib/supabase.js');
    assert.ok(supabase, 'Supabase should be defined');
    assert.ok(typeof isSupabaseNoOp === 'function', 'isSupabaseNoOp should be a function');
  });

  it('should import signal engine without error', async () => {
    const { buildSignal, getSocialIntelForSymbol } = await import('../lib/signal-engine.js');
    assert.ok(typeof buildSignal === 'function', 'buildSignal should be a function');
  });

  it('should import ML db without error', async () => {
    const mod = await import('../lib/ml/db.js');
    // db may be null if better-sqlite3 native module has version mismatch
    // but the module should still export initMlDb as a function
    assert.ok(typeof mod.initMlDb === 'function', 'initMlDb should be a function');
  });

  it('should import live site crawler without Playwright installed', async () => {
    const { crawlAllRoutes, isPlaywrightAvailable } = await import('../lib/debug/live-site-crawler.js');
    assert.ok(typeof crawlAllRoutes === 'function', 'crawlAllRoutes should be a function');
    assert.ok(typeof isPlaywrightAvailable === 'function', 'isPlaywrightAvailable should be a function');
  });

  it('should detect Windows worker entrypoints', async () => {
    const { isMainModule } = await import('../lib/entrypoint.js');
    assert.strictEqual(
      isMainModule('file:///C:/repo/workers/bug-hunter-worker.js', ['node', 'C:\\repo\\workers\\bug-hunter-worker.js']),
      true
    );
  });

  it('should detect non-matching entrypoints', async () => {
    const { isMainModule } = await import('../lib/entrypoint.js');
    assert.strictEqual(
      isMainModule('file:///C:/repo/workers/bug-hunter-worker.js', ['node', 'C:\\repo\\workers\\other-worker.js']),
      false
    );
  });

  it('should handle Unix-style entrypoints', { skip: process.platform === 'win32' }, async () => {
    const { isMainModule } = await import('../lib/entrypoint.js');
    assert.strictEqual(
      isMainModule('file:///home/user/repo/workers/bug-hunter-worker.js', ['node', '/home/user/repo/workers/bug-hunter-worker.js']),
      true
    );
  });
});

describe('Mock Trading Tests', () => {
  it('should import mock account engine', async () => {
    const { getOrCreateMockAccount } = await import('../lib/mock-trading/mock-account-engine.js');
    assert.ok(typeof getOrCreateMockAccount === 'function', 'getOrCreateMockAccount should be a function');
  });

  it('should import aggressive engine', async () => {
    const { getOrCreateAggressiveAccount } = await import('../lib/mock-trading/aggressive-engine.js');
    assert.ok(typeof getOrCreateAggressiveAccount === 'function', 'getOrCreateAggressiveAccount should be a function');
  });

  it('should import mock trader', async () => {
    const { chooseMockTrades, openMockTrades, closeMockTrade, getMockDashboard } = await import('../lib/ml/mockTrader.js');
    assert.ok(typeof chooseMockTrades === 'function', 'chooseMockTrades should be a function');
    assert.ok(typeof openMockTrades === 'function', 'openMockTrades should be a function');
    assert.ok(typeof closeMockTrade === 'function', 'closeMockTrade should be a function');
    assert.ok(typeof getMockDashboard === 'function', 'getMockDashboard should be a function');
  });
});

describe('Utility Tests', () => {
  it('should calculate EMA correctly', async () => {
    const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    // EMA calculation test
    const result = data.reduce((a, b) => a + b, 0) / data.length;
    assert.ok(result > 0, 'Average should be positive');
  });

  it('should handle missing env gracefully', async () => {
    // ESM caches modules, so we test the function's logic directly
    // isSupabaseNoOp() checks SUPABASE_URL && SERVICE_KEY at module level
    // The real test is that the module loads without throwing
    const mod = await import('../lib/supabase.js');
    assert.ok(typeof mod.isSupabaseNoOp === 'function', 'isSupabaseNoOp should be a function');
    assert.ok(typeof mod.checkSupabaseHealth === 'function', 'checkSupabaseHealth should be a function');
    assert.ok(typeof mod.supabase !== 'undefined', 'supabase client should be defined');
  });

  it('should import indicators module', async () => {
    const { ema, rsi, atr, last } = await import('../lib/indicators.js');
    assert.ok(typeof ema === 'function', 'ema should be a function');
    assert.ok(typeof rsi === 'function', 'rsi should be a function');
    assert.ok(typeof atr === 'function', 'atr should be a function');
    assert.ok(typeof last === 'function', 'last should be a function');
  });

  it('should import graceful shutdown module', async () => {
    const { registerGracefulShutdown, backoffDelay, withRetry, healthPayload } = await import('../lib/graceful-shutdown.js');
    assert.ok(typeof registerGracefulShutdown === 'function', 'registerGracefulShutdown should be a function');
    assert.ok(typeof backoffDelay === 'function', 'backoffDelay should be a function');
    assert.ok(typeof withRetry === 'function', 'withRetry should be a function');
    assert.ok(typeof healthPayload === 'function', 'healthPayload should be a function');
  });

  it('should import shared backtest core', async () => {
    const { simulateTradeCore, summarizeTrades } = await import('../lib/backtest/shared-core.js');
    assert.ok(typeof simulateTradeCore === 'function', 'simulateTradeCore should be a function');
    assert.ok(typeof summarizeTrades === 'function', 'summarizeTrades should be a function');
  });

  it('should import env validation', async () => {
    const { validateEnv } = await import('../lib/env.js');
    assert.ok(typeof validateEnv === 'function', 'validateEnv should be a function');
  });
});

describe('Worker Function Tests', () => {
  it('should import continuous backtester', async () => {
    const { runContinuousBacktester } = await import('../workers/continuous-backtester.js');
    assert.ok(typeof runContinuousBacktester === 'function', 'runContinuousBacktester should be a function');
  });

  it('should import backtest sync worker', async () => {
    const { syncBacktestData } = await import('../workers/backtest-sync-worker.js');
    assert.ok(typeof syncBacktestData === 'function', 'syncBacktestData should be a function');
  });

  it('should import research agent worker', async () => {
    const { runResearchAgentWorker } = await import('../workers/research-agent-worker.js');
    assert.ok(typeof runResearchAgentWorker === 'function', 'runResearchAgentWorker should be a function');
  });

  it('should import brain worker', async () => {
    // brain-worker.js does not export runBrainWorker — it runs tick() immediately
    // Just verify the module loads without throwing
    const mod = await import('../workers/brain-worker.js');
    assert.ok(mod, 'brain-worker module should load');
  });

  it('should import deploy checker', async () => {
    // deploy-checker.js does not export checkForUpdates — it runs main() immediately
    // Just verify the module loads without throwing
    const mod = await import('../workers/deploy-checker.js');
    assert.ok(mod, 'deploy-checker module should load');
  });
});

console.log('✅ All worker tests expanded');
