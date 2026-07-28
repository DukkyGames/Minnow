/**
 * Board model binding — resolution order and persistence.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveBoardModelBinding } from '../../src/chat/orchestrate/board-model-binding.ts';
import { validateSessionState } from '../../server/config/validators.js';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/model-board.md';

describe('resolveBoardModelBinding', () => {
  it('prefers board model override over planner chat', () => {
    const binding = resolveBoardModelBinding(
      {
        id: PLANNER_ID,
        name: 'Planner',
        workspacePath: '/tmp/ws',
        modelId: 'planner-model',
        providerId: 'planner-provider',
        history: [],
        updatedAt: 1,
      },
      {
        planPath: PLAN_PATH,
        tasks: [{ id: 'W1-A', title: 'T', wave: 'W1', category: 'build', status: 'planned' }],
        waves: [{ id: 'W1', status: 'planned' }],
        startedAt: 1,
        lastUpdatedAt: 1,
        modelProviderId: 'board-provider',
        modelId: 'board-model',
      },
    );
    assert.equal(binding.providerId, 'board-provider');
    assert.equal(binding.modelId, 'board-model');
  });

  it('falls back to planner chat when board has no model', () => {
    const binding = resolveBoardModelBinding(
      {
        id: PLANNER_ID,
        name: 'Planner',
        workspacePath: '/tmp/ws',
        modelId: 'planner-model',
        providerId: 'planner-provider',
        history: [],
        updatedAt: 1,
      },
      {
        planPath: PLAN_PATH,
        tasks: [{ id: 'W1-A', title: 'T', wave: 'W1', category: 'build', status: 'planned' }],
        waves: [{ id: 'W1', status: 'planned' }],
        startedAt: 1,
        lastUpdatedAt: 1,
      },
    );
    assert.equal(binding.providerId, 'planner-provider');
    assert.equal(binding.modelId, 'planner-model');
  });
});

describe('validateSessionState board model fields', () => {
  it('preserves modelProviderId and modelId on orchestrate board', () => {
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
            modelProviderId: 'fake-board',
            modelId: 'fake-board-model',
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
    assert.equal(board.modelProviderId, 'fake-board');
    assert.equal(board.modelId, 'fake-board-model');
  });
});
