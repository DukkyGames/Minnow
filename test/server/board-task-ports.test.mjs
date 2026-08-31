import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { writeWholeSessionState } from '../../server/config/sessions-repo.js';
import { validateSessionState } from '../../server/config/validators.js';
import {
  buildBoardTaskSpawnEnv,
  resolveBoardTaskSpawnEnvForCommand,
} from '../../server/workspace/board-task-ports.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

describe('board-task-ports', () => {
  test('buildBoardTaskSpawnEnv maps client and API ports', () => {
    assert.deepEqual(buildBoardTaskSpawnEnv(5200, 5300), {
      PORT: '5300',
      VITE_PORT: '5200',
      MINNOW_API_PORT: '5300',
      MINNOW_CLIENT_PORT: '5200',
      HOST: '127.0.0.1',
      VITE_DEV_SERVER_HOST: '127.0.0.1',
    });
  });

  test('resolveBoardTaskSpawnEnvForCommand injects when chat cwd matches worktree', async () => {
    const worktree = path.join(os.tmpdir(), 'minnow-wt-task-a');
    const state = {
      version: 5,
      chats: [
        {
          id: 'chat-1',
          boardGroupId: 'grp-1',
          boardTaskId: 'T1',
          worktreeRoot: worktree,
        },
      ],
      groups: [
        {
          id: 'grp-1',
          orchestrateBoard: {
            tasks: [
              {
                id: 'T1',
                worktreePath: worktree,
                devPort: 5200,
                apiPort: 5300,
              },
            ],
          },
        },
      ],
    };

    const env = await resolveBoardTaskSpawnEnvForCommand(
      { chatId: 'chat-1', cwd: worktree },
      state,
    );
    assert.deepEqual(env, buildBoardTaskSpawnEnv(5200, 5300));
  });

  test('resolveBoardTaskSpawnEnvForCommand returns undefined for non-board cwd', async () => {
    const env = await resolveBoardTaskSpawnEnvForCommand(
      { chatId: 'chat-1', cwd: '/tmp/other' },
      { version: 5, chats: [], groups: [] },
    );
    assert.equal(env, undefined);
  });
});

describe('board-task-ports (SQLite hot path)', () => {
  let homeDir;
  let savedHome;
  let savedStore;

  before(() => {
    savedHome = process.env.MINNOW_HOME;
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, `minnow-board-ports-db-${Date.now()}`);
  });

  after(() => {
    closeSessionsDb();
    if (savedHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = savedHome;
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    return rmTestHome(homeDir);
  });

  test('resolves ports from board_tasks without injectedState', async () => {
    const worktree = path.join(os.tmpdir(), 'minnow-wt-task-db');
    const state = validateSessionState({
      version: 5,
      chats: [
        {
          id: 'chat-1',
          name: 'Board chat',
          modelId: '',
          history: [],
          updatedAt: 1,
          boardGroupId: 'grp-1',
          boardTaskId: 'T1',
          worktreeRoot: worktree,
        },
      ],
      groups: [
        {
          id: 'grp-1',
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
                id: 'T1',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'in_progress',
                worktreePath: worktree,
                devPort: 5200,
                apiPort: 5300,
              },
            ],
            waves: [{ id: 'W1', status: 'in_progress' }],
            finalTest: { status: 'pending' },
          },
        },
      ],
    });
    writeWholeSessionState(state);

    const env = await resolveBoardTaskSpawnEnvForCommand({
      chatId: 'chat-1',
      cwd: worktree,
    });
    assert.deepEqual(env, buildBoardTaskSpawnEnv(5200, 5300));
  });

  test('returns undefined for non-board cwd via SQLite path', async () => {
    // No chatId — by-cwd scan only; path must not match any board_tasks.worktree_path.
    const env = await resolveBoardTaskSpawnEnvForCommand({
      cwd: path.join(os.tmpdir(), 'minnow-not-a-worktree'),
    });
    assert.equal(env, undefined);
  });
});
