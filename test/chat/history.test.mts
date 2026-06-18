import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearPostToolTailBeforeSend,
  copyHistoryForOutboundApi,
  repairSessionHistoryTail,
  rollbackFailedTurnHistory,
} from '../../src/chat/history.ts';
import { hasPostToolTail } from '../../src/tools/turn-continuation.ts';
import type { Chat, Message } from '../../src/types.ts';

function poisonedChat(): Chat {
  const history: Message[] = [
    { role: 'user', content: 'read missing file' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"nope"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'Error: not found' },
  ];
  return {
    id: 'chat_test',
    title: 'test',
    modeId: 'general',
    history,
    lastStats: null,
    modelInfo: {},
    updatedAt: 0,
  };
}

describe('chat/history (MIN-184)', () => {
  test('copyHistoryForOutboundApi drops incomplete assistant tool_calls tail', () => {
    const history: Message[] = [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_x',
            type: 'function',
            function: { name: 'get_datetime', arguments: '{}' },
          },
        ],
      },
    ];
    const outbound = copyHistoryForOutboundApi(history);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].role, 'user');
    assert.equal(history.length, 2);
  });

  test('rollbackFailedTurnHistory keeps user row and drops partial tool loop', () => {
    const chat = poisonedChat();
    assert.equal(hasPostToolTail(chat.history), true);
    const ok = rollbackFailedTurnHistory(chat, 0);
    assert.equal(ok, true);
    assert.equal(chat.history.length, 1);
    assert.equal(chat.history[0].role, 'user');
    assert.equal(hasPostToolTail(chat.history), false);
  });

  test('rollbackFailedTurnHistory is false when nothing to remove', () => {
    const chat = poisonedChat();
    chat.history = chat.history.slice(0, 1);
    assert.equal(rollbackFailedTurnHistory(chat, 0), false);
  });

  test('repairSessionHistoryTail drops only incomplete tool chains', () => {
    const history: Message[] = [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_x',
            type: 'function',
            function: { name: 'get_datetime', arguments: '{}' },
          },
        ],
      },
    ];
    const chat: Chat = {
      id: 'chat_incomplete',
      title: 'test',
      modeId: 'general',
      history,
      lastStats: null,
      modelInfo: {},
      updatedAt: 0,
    };
    assert.equal(repairSessionHistoryTail(chat), true);
    assert.equal(chat.history.length, 1);
  });

  test('clearPostToolTailBeforeSend removes answered tool tail before reprompt', () => {
    const chat = poisonedChat();
    assert.equal(clearPostToolTailBeforeSend(chat), true);
    assert.equal(chat.history.length, 1);
    assert.equal(hasPostToolTail(chat.history), false);
  });
});
