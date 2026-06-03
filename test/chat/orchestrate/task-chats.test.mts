/**
 * Task-related chat discovery for Orchestrate Kanban cards.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { listTaskRelatedChats } from '../../../src/chat/orchestrate/task-chats.ts';
import type { BoardTask, Chat, ChatGroup } from '../../../src/types.ts';

const GROUP_ID = 'group-fixture-001';
const TASK_ID = 'W1-A';
const PRIMARY_CHAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORPHAN_CHAT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function group(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Plan folder',
    workspacePath: '/workspace',
    collapsed: false,
    order: 0,
    createdAt: 1,
  };
}

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: TASK_ID,
    title: 'Task A',
    wave: 'W1',
    category: 'build',
    status: 'in_progress',
    chatId: PRIMARY_CHAT_ID,
    ...overrides,
  };
}

describe('listTaskRelatedChats', () => {
  test('returns primary chat first and dedupes', () => {
    const chats: Chat[] = [
      {
        id: PRIMARY_CHAT_ID,
        name: `Task ${TASK_ID}: Task A`,
        workspacePath: '/workspace',
        modelId: '',
        groupId: GROUP_ID,
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
      } as Chat,
      {
        id: ORPHAN_CHAT_ID,
        name: `Task ${TASK_ID}: Task A (copy)`,
        workspacePath: '/workspace',
        modelId: '',
        boardGroupId: GROUP_ID,
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
      } as Chat,
    ];

    const rows = listTaskRelatedChats(task(), group(), chats);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].chatId, PRIMARY_CHAT_ID);
    assert.equal(rows[0].isPrimary, true);
    assert.equal(rows[1].chatId, ORPHAN_CHAT_ID);
  });

  test('discovers chat by boardTaskId without chatId on task', () => {
    const linkedId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const chats: Chat[] = [
      {
        id: linkedId,
        name: 'Worker',
        workspacePath: '/workspace',
        modelId: '',
        boardGroupId: GROUP_ID,
        boardTaskId: TASK_ID,
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
      } as Chat,
    ];

    const rows = listTaskRelatedChats(task({ chatId: undefined }), group(), chats);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].chatId, linkedId);
  });
});
