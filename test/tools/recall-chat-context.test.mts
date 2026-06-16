/**
 * recall_chat_context browser tool (MIN-139).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatArchiveRecallOutput,
  resolveRecallScope,
  toolRecallChatContext,
} from '../../src/tools/recall-chat-context.ts';

describe('recall_chat_context helpers', () => {
  test('resolveRecallScope defaults to chat', () => {
    assert.deepEqual(resolveRecallScope({}, 'chat-abc'), { chatId: 'chat-abc' });
  });

  test('resolveRecallScope workspace opt-in', () => {
    assert.deepEqual(resolveRecallScope({ scope: 'workspace' }, 'chat-abc'), {
      mode: 'workspace',
    });
  });

  test('formatArchiveRecallOutput includes quote and path', () => {
    const out = formatArchiveRecallOutput(
      'JWT',
      [
        {
          path: 'workspaces/ws/archive/c1/turns-0000-0001.md',
          title: 'Turn bundle',
          excerpt: 'We chose JWT.',
          sourceQuote: 'JWT keeps stateless auth simple',
        },
      ],
      '(chat scope)',
    );
    assert.match(out, /Turn bundle/);
    assert.match(out, /JWT keeps stateless auth simple/);
    assert.match(out, /chat scope/);
  });

  test('formatArchiveRecallOutput empty hits', () => {
    const out = formatArchiveRecallOutput('billing', [], 'this chat');
    assert.match(out, /No archived context found for this chat/);
  });
});

describe('toolRecallChatContext', () => {
  test('requires query', async () => {
    const out = await toolRecallChatContext({});
    assert.match(out, /"query" is required/);
  });
});
