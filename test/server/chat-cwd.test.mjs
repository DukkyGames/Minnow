/**
 * resolveChatCwd — agent terminal cwd from session state (MIN-275).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveChatCwd } from '../../server/workspace/chat-cwd.js';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TASK_ID = 'W1-A';
const WORKTREE_DIRECT = 'C:/worktrees/board-a/task-W1-A';
const WORKTREE_FROM_TASK = 'C:/worktrees/board-a/task-from-board';

/** Minimal session state for injected resolveChatCwd calls. */
function baseState(overrides = {}) {
  return {
    version: 5,
    activeId: CHAT_ID,
    sidebarCollapsed: false,
    chats: [],
    groups: [],
    ...overrides,
  };
}

describe('resolveChatCwd', () => {
  it('returns chat.worktreeRoot when set', async () => {
    const state = baseState({
      chats: [
        {
          id: CHAT_ID,
          name: 'Task chat',
          modelId: '',
          modeId: 'build',
          history: [],
          updatedAt: 1,
          worktreeRoot: WORKTREE_DIRECT,
        },
      ],
    });
    const cwd = await resolveChatCwd(CHAT_ID, state);
    assert.equal(cwd, WORKTREE_DIRECT);
  });

  it('falls back to board task worktreePath', async () => {
    const state = baseState({
      chats: [
        {
          id: CHAT_ID,
          name: 'Task chat',
          modelId: '',
          modeId: 'build',
          history: [],
          updatedAt: 1,
          boardGroupId: GROUP_ID,
          boardTaskId: TASK_ID,
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
          orchestrateBoard: {
            planPath: 'plan.md',
            executionMode: 'auto',
            tasks: [
              {
                id: TASK_ID,
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'in_progress',
                worktreePath: WORKTREE_FROM_TASK,
              },
            ],
            waves: [{ id: 'W1', status: 'in_progress' }],
            finalTest: { status: 'pending' },
          },
        },
      ],
    });
    const cwd = await resolveChatCwd(CHAT_ID, state);
    assert.equal(cwd, WORKTREE_FROM_TASK);
  });

  it('returns undefined when group or task is missing', async () => {
    const state = baseState({
      chats: [
        {
          id: CHAT_ID,
          name: 'Task chat',
          modelId: '',
          modeId: 'build',
          history: [],
          updatedAt: 1,
          boardGroupId: GROUP_ID,
          boardTaskId: 'missing-task',
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
          orchestrateBoard: {
            planPath: 'plan.md',
            executionMode: 'auto',
            tasks: [],
            waves: [],
            finalTest: { status: 'pending' },
          },
        },
      ],
    });
    const cwd = await resolveChatCwd(CHAT_ID, state);
    assert.equal(cwd, undefined);
  });

  it('returns undefined for unknown chatId', async () => {
    const state = baseState({
      chats: [
        {
          id: CHAT_ID,
          name: 'Task chat',
          modelId: '',
          modeId: 'build',
          history: [],
          updatedAt: 1,
          worktreeRoot: WORKTREE_DIRECT,
        },
      ],
    });
    const cwd = await resolveChatCwd('00000000-0000-0000-0000-000000000000', state);
    assert.equal(cwd, undefined);
  });

  it('returns undefined when injected state is invalid', async () => {
    const cwd = await resolveChatCwd(CHAT_ID, /** @type {never} */ ({ version: 'bad' }));
    assert.equal(cwd, undefined);
  });
});
