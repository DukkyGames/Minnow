/**
 * todo_write validation and execution (MIN-273).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  executeTodoWrite,
  normalizeTodoStatus,
  validateTodoWriteArgs,
} from '../../src/tools/todo-tools.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  getChatTodos,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function seedChat(overrides: { boardTaskId?: string } = {}) {
  const chat = createEmptyChatObject('m1');
  chat.id = CHAT_ID;
  chat.modeId = 'build';
  if (overrides.boardTaskId) chat.boardTaskId = overrides.boardTaskId;
  setSessionStateForTests({
    version: 5,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

afterEach(() => {
  flushScheduledSessionSaveForTests();
  setSessionStateForTests(null);
});

describe('validateTodoWriteArgs', () => {
  test('accepts a valid ordered list', () => {
    const result = validateTodoWriteArgs({
      todos: [
        { text: 'Read code', status: 'completed' },
        { text: 'Implement feature', status: 'in_progress' },
        { text: 'Run tests', status: 'pending' },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.args.todos.length, 3);
    assert.equal(result.args.todos[1]?.status, 'in_progress');
  });

  test('empty list clears the checklist', () => {
    const result = validateTodoWriteArgs({ todos: [] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.args.todos, []);
  });

  test('caps at 20 items', () => {
    const todos = Array.from({ length: 25 }, (_, i) => ({
      text: `Step ${i + 1}`,
      status: 'pending',
    }));
    const result = validateTodoWriteArgs({ todos });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.args.todos.length, 20);
  });

  test('truncates long text to 140 chars', () => {
    const long = 'x'.repeat(200);
    const result = validateTodoWriteArgs({
      todos: [{ text: long, status: 'pending' }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.args.todos[0]?.text.length, 140);
  });

  test('normalizes status synonyms', () => {
    assert.equal(normalizeTodoStatus('done'), 'completed');
    assert.equal(normalizeTodoStatus('ACTIVE'), 'in_progress');
    assert.equal(normalizeTodoStatus('not started'), 'pending');

    const result = validateTodoWriteArgs({
      todos: [
        { text: 'A', status: 'finished' },
        { text: 'B', status: 'doing' },
        { text: 'C', status: 'open' },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.args.todos.map((t) => t.status),
      ['completed', 'in_progress', 'pending'],
    );
  });

  test('demotes extra in_progress items to pending', () => {
    const result = validateTodoWriteArgs({
      todos: [
        { text: 'A', status: 'in_progress' },
        { text: 'B', status: 'in_progress' },
        { text: 'C', status: 'in_progress' },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.args.todos.map((t) => t.status),
      ['in_progress', 'pending', 'pending'],
    );
  });

  test('coerces stringified todos array', () => {
    const payload = JSON.stringify([
      { text: 'Parse me', status: 'pending' },
    ]);
    const result = validateTodoWriteArgs({ todos: payload });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.args.todos[0]?.text, 'Parse me');
  });
});

describe('executeTodoWrite', () => {
  test('writes todos to the active chat and returns progress', () => {
    const chat = seedChat();
    const out = executeTodoWrite(
      {
        todos: [
          { text: 'One', status: 'completed' },
          { text: 'Two', status: 'in_progress' },
          { text: 'Three', status: 'pending' },
        ],
      },
      { chatId: CHAT_ID },
    );
    const parsed = JSON.parse(out) as { progress: string; todos: unknown[] };
    assert.equal(parsed.progress, '1/3');
    assert.equal(getChatTodos(chat)?.length, 3);
  });

  test('empty list clears todos', () => {
    const chat = seedChat();
    executeTodoWrite(
      { todos: [{ text: 'Only step', status: 'pending' }] },
      { chatId: CHAT_ID },
    );
    assert.equal(getChatTodos(chat)?.length, 1);
    const out = executeTodoWrite({ todos: [] }, { chatId: CHAT_ID });
    assert.match(out, /"progress":"0\/0"/);
    assert.equal(getChatTodos(chat), undefined);
  });

  test('errors when chat is missing', () => {
    setSessionStateForTests(null);
    const out = executeTodoWrite({ todos: [] }, { chatId: CHAT_ID });
    assert.match(out, /^Error: active chat not found/);
  });

  test('rejects board task chats', () => {
    seedChat({ boardTaskId: 'W1-A' });
    const out = executeTodoWrite(
      { todos: [{ text: 'Nope', status: 'pending' }] },
      { chatId: CHAT_ID },
    );
    assert.match(out, /not available on orchestrate board task chats/);
  });
});
