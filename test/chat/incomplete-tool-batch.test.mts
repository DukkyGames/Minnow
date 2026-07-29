import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  chatAwaitingUserInputTool,
  findIncompleteToolBatchAtTail,
} from '../../src/chat/incomplete-tool-batch.ts';
import type { Chat, Message } from '../../src/types.ts';

function makeChat(history: Message[]): Chat {
  return {
    id: 'chat-1',
    name: 'Test',
    history,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('incomplete-tool-batch', () => {
  test('findIncompleteToolBatchAtTail returns pending ask_question at tail', () => {
    const chat = makeChat([
      { role: 'user', content: 'pick one' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_q',
            type: 'function',
            function: {
              name: 'ask_question',
              arguments: JSON.stringify({
                questions: [
                  {
                    id: 'scope',
                    prompt: 'Scope?',
                    options: [
                      { id: 'a', label: 'A' },
                      { id: 'b', label: 'B' },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      },
    ]);

    const batch = findIncompleteToolBatchAtTail(chat);
    assert.ok(batch);
    assert.equal(batch.pendingToolCalls.length, 1);
    assert.equal(batch.pendingToolCalls[0]?.function.name, 'ask_question');
    assert.equal(chatAwaitingUserInputTool(chat), true);
  });

  test('findIncompleteToolBatchAtTail returns remaining tools after partial results', () => {
    const chat = makeChat([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_a',
            type: 'function',
            function: { name: 'get_datetime', arguments: '{}' },
          },
          {
            id: 'call_q',
            type: 'function',
            function: {
              name: 'ask_question',
              arguments: JSON.stringify({
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Pick',
                    options: [
                      { id: 'x', label: 'X' },
                      { id: 'y', label: 'Y' },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_a', content: '2026-01-01' },
    ]);

    const batch = findIncompleteToolBatchAtTail(chat);
    assert.ok(batch);
    assert.equal(batch.pendingToolCalls.length, 1);
    assert.equal(batch.pendingToolCalls[0]?.id, 'call_q');
  });

  test('findIncompleteToolBatchAtTail returns null when tool batch is complete', () => {
    const chat = makeChat([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_q',
            type: 'function',
            function: {
              name: 'ask_question',
              arguments: JSON.stringify({
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Pick',
                    options: [
                      { id: 'x', label: 'X' },
                      { id: 'y', label: 'Y' },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_q',
        content: JSON.stringify({
          status: 'answered',
          answers: [{ questionId: 'q1', selectedIds: ['x'], otherText: null }],
        }),
      },
      { role: 'assistant', content: 'Thanks.' },
    ]);

    assert.equal(findIncompleteToolBatchAtTail(chat), null);
    assert.equal(chatAwaitingUserInputTool(chat), false);
  });

  test('chatAwaitingUserInputTool is false when only non-interactive tools are pending', () => {
    const chat = makeChat([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_a',
            type: 'function',
            function: { name: 'get_datetime', arguments: '{}' },
          },
        ],
      },
    ]);

    assert.ok(findIncompleteToolBatchAtTail(chat));
    assert.equal(chatAwaitingUserInputTool(chat), false);
  });

  test('chatAwaitingUserInputTool is false when history is not loaded', () => {
    const chat = makeChat([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_q',
            type: 'function',
            function: { name: 'ask_question', arguments: '{}' },
          },
        ],
      },
    ]);
    chat.historyLoaded = false;
    assert.equal(chatAwaitingUserInputTool(chat), false);
  });
});
