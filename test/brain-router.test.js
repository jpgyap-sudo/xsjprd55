// ============================================================
// Brain Router Tests — Verifies the Trading Central Brain
// pipeline produces correctly shaped decision objects.
// ============================================================

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Mock Supabase before importing brain modules
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { runTradingBrain } = await import('../lib/brain/brain-router.js');

describe('Trading Central Brain', () => {
  describe('runTradingBrain', () => {
    it('should return a decision object with required fields', async () => {
      const decision = await runTradingBrain({
        symbol: 'BTCUSDT',
        timeframe: '15m',
        mode: 'paper'
      });

      // Check required fields exist
      assert.ok(decision, 'decision should exist');
      assert.equal(typeof decision, 'object', 'decision should be an object');
      assert.equal(decision.symbol, 'BTCUSDT', 'symbol should match input');
      assert.equal(decision.timeframe, '15m', 'timeframe should match input');
      assert.equal(decision.mode, 'paper', 'mode should match input');

      // Check strategy fields
      assert.ok(decision.side, 'side should exist');
      assert.ok(['LONG', 'SHORT', 'NEUTRAL'].includes(decision.side), 'side should be valid');
      assert.ok(typeof decision.confidence === 'number', 'confidence should be a number');
      assert.ok(decision.confidence >= 0 && decision.confidence <= 1, 'confidence should be 0-1');

      // Check risk fields
      assert.ok(decision.risk_verdict, 'risk_verdict should exist');
      assert.ok(['APPROVED', 'BLOCKED'].includes(decision.risk_verdict), 'risk_verdict should be valid');
      assert.ok(Array.isArray(decision.risk_gates), 'risk_gates should be an array');

      // Check explanation
      assert.ok(decision.explanation, 'explanation should exist');
      assert.ok(decision.explanation_provider, 'explanation_provider should exist');

      // Check context summary
      assert.ok(decision.context_summary, 'context_summary should exist');
      assert.ok(typeof decision.context_summary.market_ok === 'boolean', 'market_ok should be boolean');
      assert.ok(typeof decision.context_summary.liquidation_bias === 'number', 'liquidation_bias should be number');
      assert.ok(typeof decision.context_summary.news_sentiment === 'number', 'news_sentiment should be number');

      // Check timestamps
      assert.ok(decision.generated_at, 'generated_at should exist');
      assert.ok(new Date(decision.generated_at).getTime(), 'generated_at should be valid date');
    });

    it('should use defaults when no input provided', async () => {
      const decision = await runTradingBrain({});
      assert.equal(decision.symbol, 'BTCUSDT', 'default symbol should be BTCUSDT');
      assert.equal(decision.timeframe, '15m', 'default timeframe should be 15m');
      assert.equal(decision.mode, 'paper', 'default mode should be paper');
    });

    it('should accept ETHUSDT symbol', async () => {
      const decision = await runTradingBrain({
        symbol: 'ETHUSDT',
        timeframe: '1h',
        mode: 'paper'
      });

      assert.equal(decision.symbol, 'ETHUSDT');
      assert.equal(decision.timeframe, '1h');
    });

    it('should accept live mode parameter', async () => {
      const decision = await runTradingBrain({
        symbol: 'BTCUSDT',
        timeframe: '15m',
        mode: 'live'
      });

      assert.equal(decision.mode, 'live');
    });

    it('should always return risk_gates as array', async () => {
      const decision = await runTradingBrain({
        symbol: 'BTCUSDT',
        timeframe: '15m',
        mode: 'paper'
      });

      assert.ok(Array.isArray(decision.risk_gates));
    });

    it('should return explanation as string', async () => {
      const decision = await runTradingBrain({
        symbol: 'BTCUSDT',
        timeframe: '15m',
        mode: 'paper'
      });

      assert.equal(typeof decision.explanation, 'string');
      assert.ok(decision.explanation.length > 0);
    });

    it('should return context_summary with all required fields', async () => {
      const decision = await runTradingBrain({
        symbol: 'BTCUSDT',
        timeframe: '15m',
        mode: 'paper'
      });

      const summary = decision.context_summary;
      assert.ok('market_ok' in summary);
      assert.ok('liquidation_bias' in summary);
      assert.ok('news_sentiment' in summary);
      assert.ok('market_age_seconds' in summary);
    });

    it('should handle 4h timeframe', async () => {
      const decision = await runTradingBrain({
        symbol: 'BTCUSDT',
        timeframe: '4h',
        mode: 'paper'
      });

      assert.equal(decision.timeframe, '4h');
    });
  });
});
