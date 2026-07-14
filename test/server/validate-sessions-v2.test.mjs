/**
 * Server session validator — v1 input persists as current SESSION_SCHEMA_VERSION.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateSessionState } from '../../server/config/validators.js';

describe('validateSessionState workspace schema', () => {
  it('accepts v1 input and returns version 5 with workspacePath', () => {
    const out = validateSessionState({
      version: 1,
      activeId: 'chat-1',
      sidebarCollapsed: false,
      chats: [
        {
          id: 'chat-1',
          name: 'Old',
          modelId: '',
          history: [],
          updatedAt: 1,
        },
      ],
    });

    assert.equal(out.version, 5);
    assert.equal(out.chats[0].workspacePath, '');
    assert.deepEqual(out.lastActiveChatIdByWorkspace, {});
    assert.deepEqual(out.groups, []);
  });

  it('accepts v5 input with sidebar groups', () => {
    const out = validateSessionState({
      version: 5,
      activeId: 'chat-1',
      sidebarCollapsed: false,
      activeBoardGroupId: 'grp-1',
      groups: [
        {
          id: 'grp-1',
          name: 'Plan A',
          workspacePath: 'C:/demo',
          collapsed: false,
          order: 0,
          createdAt: 1,
        },
      ],
      chats: [
        {
          id: 'chat-1',
          name: 'Planner',
          workspacePath: 'C:/demo',
          modelId: '',
          boardGroupId: 'grp-1',
          history: [],
          updatedAt: 1,
        },
      ],
    });

    assert.equal(out.version, 5);
    assert.equal(out.activeBoardGroupId, 'grp-1');
    assert.equal(out.groups[0].name, 'Plan A');
    assert.equal(out.chats[0].boardGroupId, 'grp-1');
  });

  it('preserves MIN-275 worktree isolation fields on chats and board tasks', () => {
    const worktreeRoot =
      'C:/Users/test/.minnow/worktrees/repo-abc/grp-1/task-W5-A';
    const out = validateSessionState({
      version: 5,
      activeId: 'test-chat',
      sidebarCollapsed: false,
      groups: [
        {
          id: 'grp-1',
          name: 'Board',
          workspacePath: 'C:/demo/Water Tracker',
          collapsed: false,
          order: 0,
          createdAt: 1,
          orchestrateBoard: {
            planPath: 'documentation/plans/p.md',
            startedAt: 1,
            lastUpdatedAt: 1,
            executionMode: 'auto',
            isolationMode: 'per-task',
            integrationBranch: 'minnow/board/grp-1/integration',
            waves: [{ id: 'W5', status: 'in_progress' }],
            tasks: [
              {
                id: 'W5-A',
                title: 'Notifications',
                wave: 'W5',
                category: 'test',
                status: 'testing',
                worktreePath: worktreeRoot,
                worktreeBranch: 'minnow/board/grp-1/task/W5-A',
                devPort: 5200,
              },
            ],
          },
        },
      ],
      chats: [
        {
          id: 'test-chat',
          name: 'Test W5-A',
          workspacePath: 'C:/demo/Water Tracker',
          modelId: '',
          boardGroupId: 'grp-1',
          boardTaskId: 'W5-A',
          worktreeRoot,
          workAgentId: 'tester',
          history: [],
          updatedAt: 1,
        },
      ],
    });

    assert.equal(out.chats[0].worktreeRoot, worktreeRoot);
    assert.equal(out.chats[0].boardTaskId, 'W5-A');
    assert.equal(out.chats[0].workAgentId, 'tester');
    const board = out.groups[0].orchestrateBoard;
    assert.equal(board.isolationMode, 'per-task');
    assert.equal(board.integrationBranch, 'minnow/board/grp-1/integration');
    assert.equal(board.tasks[0].worktreePath, worktreeRoot);
    assert.equal(board.tasks[0].worktreeBranch, 'minnow/board/grp-1/task/W5-A');
    assert.equal(board.tasks[0].devPort, 5200);
  });

  it('preserves superPlan on chats across validateSessionState round-trip', () => {
    const stages = {
      grill: { status: 'done' },
      spec_confirm: { status: 'done' },
      research: { status: 'running', startedAt: 2000 },
      draft1: { status: 'pending' },
      review1: { status: 'pending' },
      draft2: { status: 'pending' },
      review2: { status: 'pending' },
      impeccable: { status: 'pending' },
      finalize: { status: 'pending' },
      present: { status: 'pending' },
    };
    const out = validateSessionState({
      version: 5,
      activeId: 'chat-sp',
      sidebarCollapsed: false,
      chats: [
        {
          id: 'chat-sp',
          name: 'Super Plan chat',
          workspacePath: '',
          modelId: 'test-model',
          modeId: 'super-plan',
          history: [{ role: 'user', content: 'Add OAuth login' }],
          updatedAt: 1,
          superPlan: {
            slug: 'oauth',
            prompt: 'Add OAuth login',
            activeStage: 'research',
            stages,
            specPath: 'documentation/plans/references/oauth-spec.md',
            researchPath: 'documentation/plans/references/oauth-research.md',
            planPath: 'documentation/plans/oauth.md',
            uiInvolved: false,
            researchId: 'research-run-1',
          },
        },
      ],
    });

    assert.equal(out.chats[0].modeId, 'super-plan');
    assert.deepEqual(out.chats[0].superPlan, {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'research',
      stages,
      specPath: 'documentation/plans/references/oauth-spec.md',
      researchPath: 'documentation/plans/references/oauth-research.md',
      planPath: 'documentation/plans/oauth.md',
      uiInvolved: false,
      researchId: 'research-run-1',
    });
  });

  it('preserves activeGoal on chats across validateSessionState round-trip', () => {
    const out = validateSessionState({
      version: 5,
      activeId: 'chat-1',
      sidebarCollapsed: false,
      chats: [
        {
          id: 'chat-1',
          name: 'Goal chat',
          workspacePath: '',
          modelId: 'test-model',
          history: [],
          updatedAt: 1,
          activeGoal: {
            conditionText: 'All tests pass',
            startedAt: 1000,
            turnCount: 3,
            tokenBaseline: 500,
            lastReason: 'Still failing lint',
            achieved: false,
          },
        },
      ],
    });

    assert.deepEqual(out.chats[0].activeGoal, {
      conditionText: 'All tests pass',
      startedAt: 1000,
      turnCount: 3,
      tokenBaseline: 500,
      lastReason: 'Still failing lint',
    });
  });

  it('rejects unknown session versions', () => {
    assert.throws(
      () =>
        validateSessionState({
          version: 99,
          activeId: 'x',
          chats: [],
        }),
      /Invalid session version/,
    );
  });
});
