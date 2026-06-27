/**
 * Board task chat history trim after terminal completion.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  TASK_HISTORY_KEEP_TOOL_ROUNDS,
  TASK_HISTORY_TOOL_BODY_MAX,
  TASK_HISTORY_TRIM_MARKER,
  trimBoardTaskChatHistory,
  trimTaskRelatedChats,
} from '../../src/chat/orchestrate/task-history-trim.ts';
import type { Chat, ToolCall } from '../../src/types.ts';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_CHAT_ID = '33333333-3333-3333-3333-333333333333';

function makeToolCall(id: string): ToolCall {
  return {
    id,
    type: 'function',
    function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
  };
}

function makeBoardTaskChat(rounds: number): Chat {
  const history: Chat['history'] = [];
  for (let r = 0; r < rounds; r++) {
    const toolCallId = `call-${r}`;
    history.push({
      role: 'assistant',
      content: null,
      tool_calls: [makeToolCall(toolCallId)],
    });
    history.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: `x${'o'.repeat(TASK_HISTORY_TOOL_BODY_MAX + 50)}`,
    });
  }
  return {
    id: CHAT_ID,
    name: 'Task chat',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history,
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardTaskId: 'W1-A',
    boardGroupId: 'grp-test',
  };
}

describe('task history trim', () => {
  test('skips trim when chat is the active chat', () => {
    const chat = makeBoardTaskChat(TASK_HISTORY_KEEP_TOOL_ROUNDS + 2);
    const before = chat.history[1]!.content;
    const changed = trimBoardTaskChatHistory(chat, CHAT_ID);
    assert.equal(changed, false);
    assert.equal(chat.history[1]!.content, before);
  });

  test('collapses older tool bodies and keeps recent rounds intact', () => {
    const chat = makeBoardTaskChat(TASK_HISTORY_KEEP_TOOL_ROUNDS + 2);
    const recentToolIdx = chat.history.length - 1;
    const recentContent = chat.history[recentToolIdx]!.content as string;

    const changed = trimBoardTaskChatHistory(chat, OTHER_CHAT_ID);
    assert.equal(changed, true);
    assert.match(String(chat.history[1]!.content), new RegExp(TASK_HISTORY_TRIM_MARKER));
    assert.equal(chat.history[recentToolIdx]!.content, recentContent);
  });

  test('trimTaskRelatedChats trims linked chats when not active', () => {
    const buildChat = makeBoardTaskChat(TASK_HISTORY_KEEP_TOOL_ROUNDS + 1);
    const chats = new Map<string, Chat>([[CHAT_ID, buildChat]]);
    trimTaskRelatedChats(
      { id: 'W1-A', title: 'T', wave: 'W1', category: 'build', status: 'complete', chatId: CHAT_ID },
      OTHER_CHAT_ID,
      (id) => chats.get(id),
    );
    assert.match(String(buildChat.history[1]!.content), new RegExp(TASK_HISTORY_TRIM_MARKER));
  });
});
