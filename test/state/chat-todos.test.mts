/**
 * Chat todos persistence via sessions (MIN-273).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  clearChatTodos,
  createEmptyChatObject,
  ensureChatShape,
  flushScheduledSessionSaveForTests,
  getChatTodos,
  setChatTodos,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

afterEach(() => {
  flushScheduledSessionSaveForTests();
  setSessionStateForTests(null);
});

describe('chat todos sessions', () => {
  test('setChatTodos and clearChatTodos mutate chat state', () => {
    const chat = createEmptyChatObject('m1');
    setChatTodos(chat, [
      { text: 'Step one', status: 'in_progress' },
      { text: 'Step two', status: 'pending' },
    ]);
    assert.equal(getChatTodos(chat)?.length, 2);
    assert.ok(typeof chat.todosUpdatedAt === 'number');

    clearChatTodos(chat);
    assert.equal(getChatTodos(chat), undefined);
    assert.equal(chat.todosUpdatedAt, undefined);
  });

  test('ensureChatShape restores and sanitizes todos', () => {
    const restored = ensureChatShape({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Test',
      workspacePath: '',
      modelId: '',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      lastMessageAt: 1,
      todos: [
        { text: '  keep me  ', status: 'completed' },
        { text: '', status: 'pending' },
        { text: 'y'.repeat(200), status: 'bogus' },
      ],
      todosUpdatedAt: 99,
    });
    assert.equal(restored.todos?.length, 2);
    assert.equal(restored.todos?.[0]?.text, 'keep me');
    assert.equal(restored.todos?.[1]?.text.length, 140);
    assert.equal(restored.todosUpdatedAt, 99);
  });
});
