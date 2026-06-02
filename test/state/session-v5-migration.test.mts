/**
 * Schema v4 → v5: chat-owned boards migrate to sidebar folders.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migrateSessionV4ToV5 } from '../../src/state/sessions.ts';
import type { Chat, SessionState } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const TASK_CHAT_ID = '22222222-2222-2222-2222-222222222222';
const PLAN_PATH = 'documentation/plans/demo-plan.md';

describe('migrateSessionV4ToV5', () => {
  test('moves orchestrateBoard to group and sets boardGroupId', () => {
    const state: SessionState = {
      version: 4,
      activeId: PLANNER_ID,
      sidebarCollapsed: false,
      groups: [
        {
          id: 'grp_legacy',
          name: 'Legacy',
          workspacePath: 'C:\\workspace\\demo',
          collapsed: false,
          order: 0,
          createdAt: 1,
        },
      ],
      chats: [
        {
          id: PLANNER_ID,
          name: 'Orchestrate',
          workspacePath: 'C:\\workspace\\demo',
          modelId: 'm',
          modeId: 'orchestrate',
          viewMode: 'board',
          orchestratePlanPath: PLAN_PATH,
          orchestrateBoard: {
            planPath: PLAN_PATH,
            groupId: 'grp_legacy',
            tasks: [
              {
                id: 'W1-A',
                title: 'Task A',
                wave: 'W1',
                category: 'build',
                status: 'planned',
                chatId: TASK_CHAT_ID,
              },
            ],
            waves: [{ id: 'W1', status: 'planned' }],
            startedAt: 1,
            lastUpdatedAt: 2,
            maxConcurrentTasks: 2,
          },
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 1,
        },
        {
          id: TASK_CHAT_ID,
          name: 'Task A',
          workspacePath: 'C:\\workspace\\demo',
          modelId: 'm',
          modeId: 'build',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 1,
        },
      ],
    };

    migrateSessionV4ToV5(state);

    assert.equal(state.version, 5);
    const planner = state.chats.find((c) => c.id === PLANNER_ID)!;
    assert.equal(planner.orchestrateBoard, undefined);
    assert.equal(planner.viewMode, undefined);
    assert.equal(planner.boardGroupId, 'grp_legacy');

    const group = state.groups?.find((g) => g.id === 'grp_legacy');
    assert.ok(group?.orchestrateBoard);
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 2);
    assert.equal(group.plannerChatId, PLANNER_ID);
    assert.equal(group.orchestratePlanPath, PLAN_PATH);
    assert.equal(group.viewMode, 'board');
    assert.equal(state.activeBoardGroupId, 'grp_legacy');

    const taskChat = state.chats.find((c) => c.id === TASK_CHAT_ID)!;
    assert.equal(taskChat.groupId, 'grp_legacy');
    assert.equal(taskChat.boardGroupId, 'grp_legacy');
  });
});
