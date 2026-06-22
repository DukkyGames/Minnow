import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  buildBoardTaskSpawnEnv,
  resolveBoardTaskSpawnEnvForCommand,
} from '../../server/workspace/board-task-ports.js';

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
