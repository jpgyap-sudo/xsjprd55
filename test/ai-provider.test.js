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
});
