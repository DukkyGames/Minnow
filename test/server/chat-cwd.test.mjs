/**
 * resolveChatCwd — agent terminal cwd from session state (MIN-275).
 * Injected-state path unchanged; DB-backed cases cover the SQLite hot path.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { writeWholeSessionState } from '../../server/config/sessions-repo.js';
import { validateSessionState } from '../../server/config/validators.js';
import { resolveChatCwd } from '../../server/workspace/chat-cwd.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

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
            status: 'running',
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
            status: 'running',
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

describe('resolveChatCwd (SQLite hot path)', () => {
  let homeDir;
  let savedHome;
  let savedStore;

  before(() => {
    savedHome = process.env.MINNOW_HOME;
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, `minnow-chat-cwd-db-${Date.now()}`);
  });

  after(() => {
    closeSessionsDb();
    if (savedHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = savedHome;
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    return rmTestHome(homeDir);
  });

  it('reads worktreeRoot from chats row without injectedState', async () => {
    const state = validateSessionState(
      baseState({
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
      }),
    );
    writeWholeSessionState(state);

    // No injectedState — must hit resolveChatWorktreeContext / SQLite.
    const cwd = await resolveChatCwd(CHAT_ID);
    assert.equal(cwd, WORKTREE_DIRECT);
  });

  it('falls back to board_tasks.worktree_path via indexed lookup', async () => {
    const state = validateSessionState(
      baseState({
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
              status: 'running',
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
      }),
    );
    writeWholeSessionState(state);

    const cwd = await resolveChatCwd(CHAT_ID);
    assert.equal(cwd, WORKTREE_FROM_TASK);
  });
});
