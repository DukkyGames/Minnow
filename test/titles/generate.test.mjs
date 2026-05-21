/**
 * Title generation with mocked provider port.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateChatTitle } from '../../src/chat/titles/generate.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';

describe('generateChatTitle', () => {
  test('returns normalized title from mock port', async () => {
    let capturedBody = null;
    const port = {
      async complete(body) {
        capturedBody = body;
        return {
          choices: [{ message: { content: 'Redis cache tuning' } }],
        };
      },
    };

    const result = await generateChatTitle(
      'How do I tune Redis?',
      {
        modelId: 'test-model',
        maxTokens: 24,
        temperature: 0.3,
      },
      port,
    );

    assert.equal(result, 'Redis cache tuning');
    assert.equal(capturedBody.stream, undefined);
    assert.equal(capturedBody.max_tokens, 24);
    assert.equal(capturedBody.temperature, 0.3);
    assert.equal(capturedBody.tools, undefined);
    assert.equal(capturedBody.messages.length, 2);
    assert.equal(capturedBody.messages[1].content, 'How do I tune Redis?');
    void FIXED_CHAT_ID;
  });

  test('ignores reasoning when content is empty', async () => {
    const port = {
      async complete() {
        return {
          choices: [
            {
              message: {
                content: '',
                reasoning: "Here's a thinking process for your request",
              },
            },
          ],
        };
      },
    };

    const result = await generateChatTitle(
      'How do I tune Redis?',
      { modelId: 'test-model', maxTokens: 24, temperature: 0.3 },
      port,
    );

    assert.equal(result, null);
  });

  test('HTTP failure returns null', async () => {
    const port = {
      async complete() {
        throw new Error('HTTP 500');
      },
    };

    const result = await generateChatTitle(
      'hello',
      { modelId: 'm', maxTokens: 24, temperature: 0.3 },
      port,
    );
    assert.equal(result, null);
  });
});
