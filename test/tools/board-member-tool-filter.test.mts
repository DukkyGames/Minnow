/**
 * Board member chats must not receive board_init / board_update_task / delegate_tasks.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyBoardMemberToolFilter,
  applyOrchestrateAutoToolFilter,
} from '../../src/chat/modes/orchestrate-tool-filter.ts';
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
  'board_report',
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
    assert.deepEqual(names, ['board_get_state', 'board_report', 'read_file']);
  });

  test('leaves all tools for chats without boardTaskId', () => {
    const chat: Chat = { ...BUILD_TASK_CHAT, boardTaskId: undefined };
    const filtered = applyBoardMemberToolFilter(defsFor(BOARD_TOOLS), chat);
    assert.equal(filtered.length, BOARD_TOOLS.length);
  });

  test('keeps ask_question for board chats in manual/sequential', () => {
    for (const mode of ['manual', 'sequential', undefined] as const) {
      const filtered = applyBoardMemberToolFilter(
        defsFor(['read_file', 'ask_question']),
        BUILD_TASK_CHAT,
        mode,
      );
      assert.ok(
        filtered.some((d) => d.function.name === 'ask_question'),
        `ask_question should survive in ${mode ?? 'undefined'}`,
      );
    }
  });

  test('strips ask_question/propose_mode_switch from board sub-agents in auto and afk', () => {
    for (const mode of ['auto', 'afk'] as const) {
      const filtered = applyBoardMemberToolFilter(
        defsFor(['read_file', 'ask_question', 'propose_mode_switch']),
        BUILD_TASK_CHAT,
        mode,
      );
      assert.deepEqual(
        filtered.map((d) => d.function.name),
        ['read_file'],
        `sub-agent prompts should be stripped in ${mode}`,
      );
    }
  });
});

describe('applyOrchestrateAutoToolFilter (planner)', () => {
  test('AFK forbids the planner from prompting the user', () => {
    const filtered = applyOrchestrateAutoToolFilter(
      defsFor(['read_file', 'ask_question', 'delegate_tasks']),
      'afk',
    );
    assert.deepEqual(filtered.map((d) => d.function.name), ['read_file']);
  });

  test('Auto lets the orchestrator ask but still hides delegate_tasks', () => {
    const filtered = applyOrchestrateAutoToolFilter(
      defsFor(['read_file', 'ask_question', 'delegate_tasks']),
      'auto',
    );
    assert.deepEqual(filtered.map((d) => d.function.name), ['read_file', 'ask_question']);
  });
});
