/**
 * Synthesis excerpt builder tests — latest pair + thinking strip.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildSynthesisExcerpt,
  buildSynthesisMessages,
  stripThinkingForExcerpt,
} from '../../src/synthesis/post-turn.ts';
import type { Chat } from '../../src/types.ts';

function makeChat(history: Chat['history']): Chat {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Test',
    workspacePath: '',
    modelId: 'test-model',
    history,
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
}

describe('buildSynthesisExcerpt', () => {
  test('uses the latest user/assistant pair from history', () => {
    const chat = makeChat([
      { role: 'user', content: 'where is your server?' },
      {
        role: 'assistant',
        content:
          '<think>old reasoning</think>\nIt runs locally on your machine.',
      },
      { role: 'user', content: 'I live in Santa Barbara.' },
      { role: 'assistant', content: 'Thanks — I will remember that.' },
    ]);

    const excerpt = buildSynthesisExcerpt(chat);
    assert.match(excerpt, /User: I live in Santa Barbara\./);
    assert.match(excerpt, /Assistant: Thanks — I will remember that\./);
    assert.doesNotMatch(excerpt, /where is your server/);
    assert.doesNotMatch(excerpt, /redacted_thinking/);
  });

  test('strips thinking blocks from assistant excerpt', () => {
    const chat = makeChat([
      { role: 'user', content: 'Tell me about Minnow.' },
      {
        role: 'assistant',
        content:
          '<think>The user wants an overview.</think>\nMinnow is a local-first assistant.',
      },
    ]);

    const excerpt = buildSynthesisExcerpt(chat);
    assert.match(excerpt, /Assistant: Minnow is a local-first assistant\./);
    assert.doesNotMatch(excerpt, /redacted_thinking/);
  });
});

describe('buildSynthesisMessages', () => {
  test('omits thinking-only assistant content', () => {
    const chat = makeChat([
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: '',
        thinking: ['only thinking here'],
      },
    ]);

    const rows = buildSynthesisMessages(chat);
    assert.deepEqual(rows, [{ role: 'user', content: 'Hello' }]);
  });
});

describe('stripThinkingForExcerpt', () => {
  test('removes closed redacted_thinking blocks', () => {
    const cleaned = stripThinkingForExcerpt(
      '<think>secret</think>\nVisible answer.',
    );
    assert.equal(cleaned, 'Visible answer.');
  });
});
