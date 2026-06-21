/**
 * Server session validator — orchestrate board running state survives PUT round-trip.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateSessionState } from '../../server/config/validators.js';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/reload-persist.md';

describe('validateSessionState orchestrate board', () => {
  it('preserves autoRunning, sequential mode, and task chat links on save', () => {
    const out = validateSessionState({
      version: 5,
      activeId: PLANNER_ID,
      sidebarCollapsed: false,
      chats: [
        {
          id: PLANNER_ID,
          name: 'Planner',
          workspacePath: '/tmp/ws',
          modelId: 'm1',
          modeId: 'orchestrate',
          history: [],
          updatedAt: 1,
          boardGroupId: GROUP_ID,
        },
      ],
      groups: [
        {
          id: GROUP_ID,
          name: 'Board',
          workspacePath: '/tmp/ws',
          collapsed: false,
          order: 0,
          createdAt: 1,
          plannerChatId: PLANNER_ID,
          orchestratePlanPath: PLAN_PATH,
          orchestrateBoard: {
            planPath: PLAN_PATH,
            executionMode: 'sequential',
            autoRunning: true,
            startedAt: 1,
            lastUpdatedAt: 2,
            tasks: [
              {
                id: 'W1-A',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'in_progress',
                chatId: '22222222-2222-2222-2222-222222222222',
                testChatId: '33333333-3333-3333-3333-333333333333',
              },
            ],
            waves: [{ id: 'W1', status: 'in_progress' }],
            finalTest: { status: 'pending' },
          },
        },
      ],
    });

    const board = out.groups[0].orchestrateBoard;
    assert.equal(board.executionMode, 'sequential');
    assert.equal(board.autoRunning, true);
    assert.equal(board.tasks[0].chatId, '22222222-2222-2222-2222-222222222222');
    assert.equal(board.tasks[0].testChatId, '33333333-3333-3333-3333-333333333333');
    assert.equal(board.finalTest?.status, 'pending');
  });

  it('preserves afk executionMode on save', () => {
    const out = validateSessionState({
      version: 5,
      activeId: PLANNER_ID,
      sidebarCollapsed: false,
      chats: [
        {
          id: PLANNER_ID,
          name: 'Planner',
          workspacePath: '/tmp/ws',
          modelId: 'm1',
          modeId: 'orchestrate',
          history: [],
          updatedAt: 1,
          boardGroupId: GROUP_ID,
        },
      ],
      groups: [
        {
          id: GROUP_ID,
          name: 'Board',
          workspacePath: '/tmp/ws',
          collapsed: false,
          order: 0,
          createdAt: 1,
          plannerChatId: PLANNER_ID,
          orchestratePlanPath: PLAN_PATH,
          orchestrateBoard: {
            planPath: PLAN_PATH,
            executionMode: 'afk',
            autoRunning: true,
            startedAt: 1,
            lastUpdatedAt: 2,
            tasks: [
              {
                id: 'W1-A',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'planned',
              },
            ],
            waves: [{ id: 'W1', status: 'planned' }],
          },
        },
      ],
    });

    const board = out.groups[0].orchestrateBoard;
    assert.equal(board.executionMode, 'afk');
    assert.equal(board.autoRunning, true);
  });

  it('coerces junk executionMode to manual', () => {
    const out = validateSessionState({
      version: 5,
      activeId: PLANNER_ID,
      sidebarCollapsed: false,
      chats: [
        {
          id: PLANNER_ID,
          name: 'Planner',
          workspacePath: '/tmp/ws',
          modelId: 'm1',
          modeId: 'orchestrate',
          history: [],
          updatedAt: 1,
          boardGroupId: GROUP_ID,
        },
      ],
      groups: [
        {
          id: GROUP_ID,
          name: 'Board',
          workspacePath: '/tmp/ws',
          collapsed: false,
          order: 0,
          createdAt: 1,
          plannerChatId: PLANNER_ID,
          orchestratePlanPath: PLAN_PATH,
          orchestrateBoard: {
            planPath: PLAN_PATH,
            executionMode: 'turbo',
            tasks: [
              {
                id: 'W1-A',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'planned',
              },
            ],
            waves: [{ id: 'W1', status: 'planned' }],
          },
        },
      ],
    });

    assert.equal(out.groups[0].orchestrateBoard.executionMode, 'manual');
  });
});
