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
