/**
 * OpenAI → AI SDK message conversion for the Anthropic bridge.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { openAiMessagesToCoreMessages } from '../../server/generations/anthropic/openai-to-core-messages.js';
import { deriveAnthropicBaseUrl } from '../../server/generations/anthropic/provider-runtime.js';

describe('deriveAnthropicBaseUrl', () => {
  test('strips the final messages segment from a gateway path', () => {
    assert.equal(
      deriveAnthropicBaseUrl('https://opencode.ai', '/zen/v1/messages'),
      'https://opencode.ai/zen/v1',
    );
  });

  test('defaults to /v1 for standard Anthropic paths', () => {
    assert.equal(
      deriveAnthropicBaseUrl('https://api.anthropic.com', '/v1/messages'),
      'https://api.anthropic.com/v1',
    );
  });
});

describe('openAiMessagesToCoreMessages', () => {
  test('folds leading system messages into one system message', () => {
    const converted = openAiMessagesToCoreMessages([
      { role: 'system', content: 'Alpha' },
      { role: 'system', content: 'Beta' },
      { role: 'user', content: 'Hello' },
    ]);

    assert.equal(converted.length, 2);
    assert.deepEqual(converted[0], { role: 'system', content: 'Alpha\n\nBeta' });
    assert.deepEqual(converted[1], { role: 'user', content: 'Hello' });
  });

  test('maps assistant tool_calls and tool results', () => {
    const converted = openAiMessagesToCoreMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'file contents',
      },
    ]);

    assert.equal(converted.length, 2);
    assert.equal(converted[0].role, 'assistant');
    assert.equal(converted[1].role, 'tool');
    assert.deepEqual(converted[1].content, [
      {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'read_file',
        output: 'file contents',
      },
    ]);
  });

  test('maps multimodal user content to text and image parts', () => {
    const converted = openAiMessagesToCoreMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this' },
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        ],
      },
    ]);

    assert.equal(converted.length, 1);
    assert.equal(converted[0].role, 'user');
    assert.deepEqual(converted[0].content, [
      { type: 'text', text: 'Describe this' },
      { type: 'image', image: 'https://example.com/a.png' },
    ]);
  });
});
