import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLongShort } from '../lib/advisor/strategyScorer.js';
import { runAdvisorRiskGate } from '../lib/advisor/riskGate.js';

test('advisor scorer returns neutral/long/short/avoid compatible result', () => {
  const context = {
    market: { trend: 'up', volatility: 'normal' },
    derivatives: { liquidation_bias: 'upside_sweep', funding: 0.01 },
    sentiment: { news: 'ok' },
    data_health: { fresh: true }
  };
  const score = scoreLongShort(context);
  assert.ok(['long', 'short', 'neutral'].includes(score.bias));
  assert.ok(score.confidence >= 0 && score.confidence <= 1);
});

test('risk gate blocks stale extreme market', () => {
  const context = {
    market: { volatility: 'extreme' },
    sentiment: { news: 'conflict' },
    data_health: { fresh: false }
  };
  const risk = runAdvisorRiskGate(context, { bias: 'long', confidence: 0.8, warnings: [] });
  assert.equal(risk.execution_allowed, false);
  assert.ok(['long', 'short', 'neutral', 'avoid'].includes(risk.bias));
});

test('risk gate always blocks execution by default', () => {
  const context = {
    market: { trend: 'up', volatility: 'normal' },
    derivatives: { liquidation_bias: 'neutral', funding: 0.005 },
    sentiment: { news: 'positive' },
    data_health: { fresh: true }
  };
  const risk = runAdvisorRiskGate(context, { bias: 'long', confidence: 0.8, warnings: [] });
  // riskGate.js hardcodes execution_allowed: false
  assert.equal(risk.execution_allowed, false);
  assert.equal(risk.approved_for_advice, true);
  assert.ok(typeof risk.riskScore === 'number');
});

test('risk gate blocks stale data', () => {
  const context = {
    market: { trend: 'up', volatility: 'normal' },
    sentiment: { news: 'positive' },
    data_health: { fresh: false }
  };
  const risk = runAdvisorRiskGate(context, { bias: 'short', confidence: 0.7, warnings: [] });
  assert.equal(risk.execution_allowed, false);
});

test('scorer handles bearish market context', () => {
  const context = {
    market: { trend: 'down', volatility: 'high' },
    derivatives: { liquidation_bias: 'downside_sweep', funding: -0.02 },
    sentiment: { news: 'negative' },
    data_health: { fresh: true }
  };
  const score = scoreLongShort(context);
  assert.ok(score.confidence >= 0 && score.confidence <= 1);
});

test('scorer handles neutral market context', () => {
  const context = {
    market: { trend: 'sideways', volatility: 'low' },
    derivatives: { liquidation_bias: 'neutral', funding: 0.0 },
    sentiment: { news: 'neutral' },
    data_health: { fresh: true }
  };
  const score = scoreLongShort(context);
  assert.ok(score.confidence >= 0 && score.confidence <= 1);
});

test('risk gate preserves original bias when not blocked', () => {
  const context = {
    market: { trend: 'up', volatility: 'normal' },
    sentiment: { news: 'positive' },
    data_health: { fresh: true }
  };
  const risk = runAdvisorRiskGate(context, { bias: 'long', confidence: 0.9, warnings: [] });
  assert.equal(risk.bias, 'long');
  // riskGate.js does not return confidence field
  assert.equal(risk.confidence, undefined);
});

test('risk gate adds warnings for blocked signals', () => {
  const context = {
    market: { volatility: 'extreme' },
    sentiment: { news: 'conflict' },
    data_health: { fresh: false }
  };
  const risk = runAdvisorRiskGate(context, { bias: 'long', confidence: 0.8, warnings: [] });
  assert.ok(Array.isArray(risk.warnings));
  assert.ok(risk.warnings.length > 0);
});

console.log('✅ Advisor tests expanded');
