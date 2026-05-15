import { describe, it } from 'node:test';
import assert from 'node:assert';

import { prepareAnthropicRequest } from '../lib/ai.js';

describe('AI provider request normalization', () => {
  it('moves system messages out of Anthropic messages payload', () => {
    const request = prepareAnthropicRequest({
      system: 'Primary system prompt',
      messages: [
        { role: 'system', content: 'History system prompt' },
        { role: 'user', content: 'What is a good short today?' },
        { role: 'assistant', content: 'Use liquidation data.' },
        { role: 'tool', content: 'ignored' }
      ]
    });

    assert.strictEqual(request.system, 'Primary system prompt\n\nHistory system prompt');
    assert.deepStrictEqual(request.messages, [
      { role: 'user', content: 'What is a good short today?' },
      { role: 'assistant', content: 'Use liquidation data.' }
    ]);
    assert.ok(request.messages.every(msg => msg.role !== 'system'));
  });

  it('handles empty messages array', () => {
    const request = prepareAnthropicRequest({
      system: 'System prompt',
      messages: []
    });

    assert.strictEqual(request.system, 'System prompt');
    assert.deepStrictEqual(request.messages, []);
  });

  it('handles missing system prompt', () => {
    const request = prepareAnthropicRequest({
      messages: [
        { role: 'user', content: 'Hello' }
      ]
    });

    assert.strictEqual(request.system, '');
    assert.deepStrictEqual(request.messages, [
      { role: 'user', content: 'Hello' }
    ]);
  });

  it('preserves user and assistant message order', () => {
    const request = prepareAnthropicRequest({
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Second answer' }
      ]
    });

    assert.strictEqual(request.messages.length, 4);
    assert.strictEqual(request.messages[0].content, 'First question');
    assert.strictEqual(request.messages[1].content, 'First answer');
    assert.strictEqual(request.messages[2].content, 'Second question');
    assert.strictEqual(request.messages[3].content, 'Second answer');
  });

  it('filters out unknown roles', () => {
    const request = prepareAnthropicRequest({
      system: 'Test',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'system', content: 'Should be filtered' },
        { role: 'function', content: 'Should be filtered' },
        { role: 'tool', content: 'Should be filtered' }
      ]
    });

    assert.strictEqual(request.messages.length, 1);
    assert.strictEqual(request.messages[0].role, 'user');
  });

  it('handles undefined messages gracefully', () => {
    const request = prepareAnthropicRequest({
      system: 'Test'
    });

    assert.strictEqual(request.system, 'Test');
    assert.deepStrictEqual(request.messages, []);
  });
});

console.log('✅ AI provider tests expanded');
