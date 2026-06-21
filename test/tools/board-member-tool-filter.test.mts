/**
 * Board member chats must not receive board_init / board_update_task / delegate_tasks.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyBoardMemberToolFilter } from '../../src/chat/modes/orchestrate-tool-filter.ts';
import type { Chat } from '../../src/types.ts';

const BUILD_TASK_CHAT: Chat = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Task W1-A',
  workspacePath: '',
  modelId: 'test-model',
  modeId: 'build',
  boardTaskId: 'W1-A',
  history: [],
  lastStats: null,
  modelInfo: {},
  updatedAt: 1,
};

const BOARD_TOOLS = [
  'board_init',
  'board_update_task',
  'delegate_tasks',
  'board_get_state',
  'board_report_test_result',
  'read_file',
];

function defsFor(names: string[]) {
  return names.map((name) => ({
    type: 'function' as const,
    function: { name, description: '', parameters: {} },
  }));
}

describe('applyBoardMemberToolFilter', () => {
  test('strips planner-only board tools for board task chats', () => {
    const filtered = applyBoardMemberToolFilter(defsFor(BOARD_TOOLS), BUILD_TASK_CHAT);
    const names = filtered.map((d) => d.function.name);
    assert.deepEqual(names, ['board_get_state', 'board_report_test_result', 'read_file']);
  });

  test('leaves all tools for chats without boardTaskId', () => {
    const chat: Chat = { ...BUILD_TASK_CHAT, boardTaskId: undefined };
    const filtered = applyBoardMemberToolFilter(defsFor(BOARD_TOOLS), chat);
    assert.equal(filtered.length, BOARD_TOOLS.length);
  });
});
