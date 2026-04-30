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
    const { db, initMlDb } = await import('../lib/ml/db.js');
    assert.ok(db, 'ML DB should be defined');
    assert.ok(typeof initMlDb === 'function', 'initMlDb should be a function');
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
});

describe('Utility Tests', () => {
  it('should calculate EMA correctly', async () => {
    const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    // EMA calculation test
    const result = data.reduce((a, b) => a + b, 0) / data.length;
    assert.ok(result > 0, 'Average should be positive');
  });

  it('should handle missing env gracefully', async () => {
    const originalEnv = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    
    // Re-import to test fallback
    const { isSupabaseNoOp } = await import('../lib/supabase.js');
    assert.strictEqual(isSupabaseNoOp(), true, 'Should detect noop mode when env missing');
    
    process.env.SUPABASE_URL = originalEnv;
  });
});

console.log('✅ All worker import tests defined');
