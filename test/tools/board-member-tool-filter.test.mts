/**
 * Board member chats: planner-only board tools stripped + per-role allowlists (MIN-333).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  applyBoardMemberToolFilter,
  applyOrchestrateAutoToolFilter,
  resolveBoardMemberRole,
} from '../../src/chat/modes/orchestrate-tool-filter.ts';
import {
  BOARD_ROLE_ALLOWED_GROUPS,
  BOARD_ROLE_BOARD_SUBSET,
  TOOL_GROUP_IDS,
  TOOL_GROUP_ID_LIST,
  expandBoardRoleAllowedTools,
  type BoardMemberRole,
} from '../../src/chat/modes/tool-groups.ts';
import { getEnabledToolDefinitionsForChat } from '../../src/tools/client.ts';
import { getBoardGroupForChat } from '../../src/state/chat-groups.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const GROUP_ID = '33333333-3333-3333-3333-333333333333';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const BUILD_CHAT_ID = '22222222-2222-2222-2222-222222222222';
const TESTER_CHAT_ID = '44444444-4444-4444-4444-444444444444';
const FIXER_CHAT_ID = '55555555-5555-5555-5555-555555555555';
const TASK_ID = 'W1-A';
const PLAN_PATH = 'documentation/plans/test-plan.md';

let builderChat: Chat;
let testerChat: Chat;
let fixerChat: Chat;

function defsFor(names: string[]) {
  return names.map((name) => ({
    type: 'function' as const,
    function: { name, description: '', parameters: {} },
  }));
}

function allBuiltinNames(): string[] {
  return BUILT_IN_TOOLS.map((t) => t.id);
}

function filteredNames(chat: Chat, executionMode?: 'manual' | 'sequential' | 'auto' | 'afk') {
  return applyBoardMemberToolFilter(
    defsFor(allBuiltinNames()),
    chat,
    executionMode,
  ).map((d) => d.function.name);
}

function groupFullyInRole(role: BoardMemberRole, groupId: keyof typeof TOOL_GROUP_IDS): boolean {
  return TOOL_GROUP_IDS[groupId].every((id) => expandBoardRoleAllowedTools(role).has(id));
}

function groupFullyDeniedForRole(role: BoardMemberRole, groupId: keyof typeof TOOL_GROUP_IDS): boolean {
  return TOOL_GROUP_IDS[groupId].every((id) => !expandBoardRoleAllowedTools(role).has(id));
}

function seedBoardSession(): ChatGroup {
  const planner = createEmptyChatObject('', '');
  planner.id = PLANNER_ID;
  planner.modeId = 'orchestrate';
  planner.orchestratePlanPath = PLAN_PATH;

  builderChat = createEmptyChatObject('', '');
  builderChat.id = BUILD_CHAT_ID;
  builderChat.modeId = 'build';
  builderChat.boardTaskId = TASK_ID;
  builderChat.boardGroupId = GROUP_ID;

  testerChat = createEmptyChatObject('', '');
  testerChat.id = TESTER_CHAT_ID;
  testerChat.modeId = 'build';
  testerChat.workAgentId = 'tester';
  testerChat.boardTaskId = TASK_ID;
  testerChat.boardGroupId = GROUP_ID;

  fixerChat = createEmptyChatObject('', '');
  fixerChat.id = FIXER_CHAT_ID;
  fixerChat.modeId = 'build';
  fixerChat.boardTaskId = TASK_ID;
  fixerChat.boardGroupId = GROUP_ID;

  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Board',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestratePlanPath: PLAN_PATH,
  };

  setSessionStateForTests({
    version: 5,
    activeId: planner.id,
    sidebarCollapsed: false,
    groups: [group],
    chats: [planner, builderChat, testerChat, fixerChat],
  });

  initBoard(group, planner, {
    planPath: PLAN_PATH,
    tasks: [
      {
        id: TASK_ID,
        title: 'Task A',
        wave: 'W1',
        category: 'build',
      },
    ],
    waves: [{ id: 'W1' }],
  });

  updateTask(group, TASK_ID, {
    chatId: BUILD_CHAT_ID,
    testChatId: TESTER_CHAT_ID,
    fixerChatId: FIXER_CHAT_ID,
  });

  return group;
}

afterEach(() => {
  flushScheduledSessionSaveForTests();
  setSessionStateForTests(null);
});

describe('resolveBoardMemberRole', () => {
  test('builder, tester, and fixer chats resolve from session board links', () => {
    seedBoardSession();
    assert.equal(resolveBoardMemberRole(builderChat), 'build');
    assert.equal(resolveBoardMemberRole(testerChat), 'test');
    assert.equal(resolveBoardMemberRole(fixerChat), 'fix');
    assert.ok(getBoardGroupForChat(builderChat)?.orchestrateBoard);
  });
});

describe('applyBoardMemberToolFilter', () => {
  test('build-mode board chats inject board_get_state and board_report from catalog', () => {
    seedBoardSession();
    const names = getEnabledToolDefinitionsForChat(builderChat).map((d) => d.function.name);
    assert.ok(names.includes('board_get_state'), 'board_get_state should be injected for build-mode task chat');
    assert.ok(names.includes('board_report'), 'board_report should be injected for build-mode task chat');
    assert.ok(!names.includes('board_init'));
    assert.ok(!names.includes('board_update_task'));
    assert.ok(!names.includes('delegate_tasks'));
  });

  test('strips planner-only board tools for board task chats', () => {
    seedBoardSession();
    const filtered = applyBoardMemberToolFilter(defsFor([
      'board_init',
      'board_update_task',
      'delegate_tasks',
      'board_get_state',
      'board_report',
      'read_file',
    ]), builderChat);
    const names = filtered.map((d) => d.function.name);
    assert.deepEqual(names, ['board_get_state', 'board_report', 'read_file']);
  });

  test('leaves all tools for chats without boardTaskId', () => {
    seedBoardSession();
    const chat: Chat = { ...builderChat, boardTaskId: undefined };
    const filtered = applyBoardMemberToolFilter(defsFor(['read_file', 'spawn_sub_agent']), chat);
    assert.equal(filtered.length, 2);
  });

  test('excludes ask_question from all board roles (MIN-333 matrix)', () => {
    seedBoardSession();
    for (const chat of [builderChat, testerChat, fixerChat]) {
      for (const mode of ['manual', 'sequential', undefined] as const) {
        const filtered = applyBoardMemberToolFilter(
          defsFor(['read_file', 'ask_question']),
          chat,
          mode,
        );
        assert.ok(
          !filtered.some((d) => d.function.name === 'ask_question'),
          `ask_question denied for ${chat.id} in ${mode ?? 'undefined'}`,
        );
      }
    }
  });

  test('strips ask_question/propose_mode_switch from board sub-agents in auto and afk', () => {
    seedBoardSession();
    for (const mode of ['auto', 'afk'] as const) {
      const filtered = applyBoardMemberToolFilter(
        defsFor(['read_file', 'ask_question', 'propose_mode_switch']),
        builderChat,
        mode,
      );
      assert.deepEqual(
        filtered.map((d) => d.function.name),
        ['read_file'],
        `sub-agent prompts should be stripped in ${mode}`,
      );
    }
  });

  test('builder includes browser, git-write, and web; excludes sub-agents and brain', () => {
    seedBoardSession();
    const names = new Set(filteredNames(builderChat));
    assert.ok(names.has('browser_navigate'));
    assert.ok(names.has('git_commit'));
    assert.ok(names.has('web_search'));
    assert.ok(names.has('save_file'));
    assert.ok(!names.has('spawn_sub_agent'));
    assert.ok(!names.has('brain_search'));
    assert.ok(!names.has('bug_add'));
    assert.ok(!names.has('load_impeccable_context'));
  });

  test('tester includes browser and git-write but not files-write', () => {
    seedBoardSession();
    const names = new Set(filteredNames(testerChat));
    assert.ok(names.has('browser_navigate'));
    assert.ok(names.has('git_commit'));
    assert.ok(names.has('web_search'));
    assert.ok(names.has('get_system_info'));
    assert.ok(!names.has('save_file'));
    assert.ok(!names.has('spawn_sub_agent'));
  });

  test('fixer includes git-write and files-write but not browser', () => {
    seedBoardSession();
    const names = new Set(filteredNames(fixerChat));
    assert.ok(names.has('git_commit'));
    assert.ok(names.has('save_file'));
    assert.ok(names.has('web_search'));
    assert.ok(!names.has('browser_navigate'));
    assert.ok(!names.has('spawn_sub_agent'));
  });

  test('MCP tools pass through board role matrix when enabled in Settings', () => {
    seedBoardSession();
    const mcpDefs = defsFor(['mcp__context7__resolve-library-id', 'read_file']);
    const names = applyBoardMemberToolFilter(mcpDefs, builderChat).map(
      (d) => d.function.name,
    );
    assert.ok(names.includes('mcp__context7__resolve-library-id'));
    assert.ok(names.includes('read_file'));
  });
});

describe('board role matrix groups', () => {
  const MATRIX: Record<BoardMemberRole, Set<keyof typeof TOOL_GROUP_IDS>> = {
    build: new Set([
      'util-basic',
      'web',
      'files-read',
      'files-write',
      'git-read',
      'git-write',
      'code-exec',
      'code-intel',
      'lsp',
      'browser',
    ]),
    test: new Set([
      'util-basic',
      'web',
      'files-read',
      'git-read',
      'git-write',
      'code-exec',
      'code-intel',
      'lsp',
      'browser',
    ]),
    fix: new Set([
      'util-basic',
      'web',
      'files-read',
      'files-write',
      'git-read',
      'git-write',
      'code-exec',
      'code-intel',
      'lsp',
    ]),
  };

  for (const role of ['build', 'test', 'fix'] as const) {
    test(`${role} matches BOARD_ROLE_ALLOWED_GROUPS matrix`, () => {
      const allowedGroups = MATRIX[role];
      assert.deepEqual(new Set(BOARD_ROLE_ALLOWED_GROUPS[role]), allowedGroups);
      for (const groupId of TOOL_GROUP_ID_LIST) {
        if (groupId === 'board') {
          for (const id of BOARD_ROLE_BOARD_SUBSET) {
            assert.ok(expandBoardRoleAllowedTools(role).has(id));
          }
          for (const id of ['board_init', 'board_update_task', 'delegate_tasks']) {
            assert.ok(!expandBoardRoleAllowedTools(role).has(id));
          }
          continue;
        }
        const shouldAllow = allowedGroups.has(groupId);
        if (shouldAllow) {
          assert.ok(
            groupFullyInRole(role, groupId),
            `${role} should allow full group ${groupId}`,
          );
        } else {
          assert.ok(
            groupFullyDeniedForRole(role, groupId),
            `${role} should deny full group ${groupId}`,
          );
        }
      }
    });
  }
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
