import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  allocateDevPort,
  boardIntegrationBranch,
  isIsolationActive,
  resolveChatWorktreeRoot,
  resolveIsolationMode,
  sanitizeRefFragment,
  tasksSharingSlot,
  taskWorktreeBranch,
  usedDevPorts,
  waveWorktreeBranch,
  worktreeBranchFor,
  worktreeSlotId,
} from '../../src/state/worktree-isolation.ts';
import type { BoardTask, OrchestrateBoardState } from '../../src/types.ts';

function board(patch: Partial<OrchestrateBoardState>): OrchestrateBoardState {
  return {
    planPath: 'documentation/plans/p.md',
    tasks: [],
    waves: [],
    startedAt: 0,
    lastUpdatedAt: 0,
    ...patch,
  };
}

function task(patch: Partial<BoardTask> & { id: string; wave: number | string }): BoardTask {
  return { title: patch.id, category: 'code', status: 'planned', ...patch };
}

describe('resolveIsolationMode', () => {
  test('explicit override wins over execution mode', () => {
    assert.equal(
      resolveIsolationMode(board({ isolationMode: 'per-wave', executionMode: 'sequential' })),
      'per-wave',
    );
    assert.equal(
      resolveIsolationMode(board({ isolationMode: 'off', executionMode: 'auto' })),
      'off',
    );
  });

  test('auto defaults to per-task; sequential/manual/unset default to off', () => {
    assert.equal(resolveIsolationMode(board({ executionMode: 'auto' })), 'per-task');
    assert.equal(resolveIsolationMode(board({ executionMode: 'sequential' })), 'off');
    assert.equal(resolveIsolationMode(board({ executionMode: 'manual' })), 'off');
    assert.equal(resolveIsolationMode(board({})), 'off');
  });

  test('null board is off; isIsolationActive mirrors resolution', () => {
    assert.equal(resolveIsolationMode(null), 'off');
    assert.equal(isIsolationActive(null), false);
    assert.equal(isIsolationActive(board({ executionMode: 'auto' })), true);
    assert.equal(isIsolationActive(board({ executionMode: 'sequential' })), false);
  });
});

describe('ref/slot naming', () => {
  test('sanitizeRefFragment strips unsafe chars, trims, bounds length', () => {
    assert.equal(sanitizeRefFragment('Wave 1/A'), 'Wave-1-A');
    assert.equal(sanitizeRefFragment('  --foo--  '), 'foo');
    assert.equal(sanitizeRefFragment(''), 'x');
    assert.equal(sanitizeRefFragment('a'.repeat(100)).length, 64);
    assert.equal(sanitizeRefFragment(7), '7');
  });

  test('branch names are stable and namespaced per board', () => {
    assert.equal(boardIntegrationBranch('grp1'), 'minnow/board/grp1/integration');
    assert.equal(taskWorktreeBranch('grp1', 'T-2'), 'minnow/board/grp1/task/T-2');
    assert.equal(waveWorktreeBranch('grp1', 'W1'), 'minnow/board/grp1/wave/W1');
  });

  test('worktreeSlotId / worktreeBranchFor follow the mode', () => {
    const t = task({ id: 'T-2', wave: 'W1' });
    assert.equal(worktreeSlotId('per-task', t), 'task-T-2');
    assert.equal(worktreeSlotId('per-wave', t), 'wave-W1');
    assert.equal(worktreeSlotId('off', t), null);
    assert.equal(worktreeBranchFor('per-task', 'g', t), 'minnow/board/g/task/T-2');
    assert.equal(worktreeBranchFor('per-wave', 'g', t), 'minnow/board/g/wave/W1');
    assert.equal(worktreeBranchFor('off', 'g', t), null);
  });
});

describe('tasksSharingSlot', () => {
  const a = task({ id: 'A', wave: 'W1' });
  const b = task({ id: 'B', wave: 'W1' });
  const c = task({ id: 'C', wave: 'W2' });
  const all = [a, b, c];

  test('per-task shares only with itself', () => {
    assert.deepEqual(tasksSharingSlot('per-task', a, all).map((t) => t.id), ['A']);
  });
  test('per-wave shares with all tasks in the same wave', () => {
    assert.deepEqual(tasksSharingSlot('per-wave', a, all).map((t) => t.id), ['A', 'B']);
  });
  test('off shares with nothing', () => {
    assert.deepEqual(tasksSharingSlot('off', a, all), []);
  });
});

describe('resolveChatWorktreeRoot', () => {
  test('prefers chat.worktreeRoot over board task path', () => {
    const direct = 'C:/wt/direct';
    const fromTask = 'C:/wt/task';
    assert.equal(
      resolveChatWorktreeRoot(
        { worktreeRoot: direct, boardGroupId: 'g', boardTaskId: 'T1' },
        [
          {
            id: 'g',
            name: 'B',
            workspacePath: '',
            collapsed: false,
            order: 0,
            createdAt: 0,
            orchestrateBoard: {
              planPath: 'p.md',
              tasks: [
                {
                  id: 'T1',
                  title: 't',
                  wave: 1,
                  category: 'code',
                  status: 'in_progress',
                  worktreePath: fromTask,
                },
              ],
              waves: [{ id: 1, status: 'in_progress' }],
              startedAt: 0,
              lastUpdatedAt: 0,
            },
          },
        ],
      ),
      direct,
    );
  });

  test('falls back to board task worktreePath', () => {
    const fromTask = 'C:/wt/task';
    assert.equal(
      resolveChatWorktreeRoot(
        { boardGroupId: 'g', boardTaskId: 'T1' },
        [
          {
            id: 'g',
            name: 'B',
            workspacePath: '',
            collapsed: false,
            order: 0,
            createdAt: 0,
            orchestrateBoard: {
              planPath: 'p.md',
              tasks: [
                {
                  id: 'T1',
                  title: 't',
                  wave: 1,
                  category: 'code',
                  status: 'testing',
                  worktreePath: fromTask,
                },
              ],
              waves: [{ id: 1, status: 'in_progress' }],
              startedAt: 0,
              lastUpdatedAt: 0,
            },
          },
        ],
      ),
      fromTask,
    );
  });
});

describe('dev port allocation', () => {
  test('allocateDevPort picks the lowest free port at/above base', () => {
    assert.equal(allocateDevPort(5200, []), 5200);
    assert.equal(allocateDevPort(5200, [5200, 5201, 5203]), 5202);
    assert.equal(allocateDevPort(5200, [5200, 5201, 5202]), 5203);
  });
  test('ignores non-finite used ports', () => {
    assert.equal(allocateDevPort(5200, [Number.NaN, 5200]), 5201);
  });
  test('usedDevPorts collects assigned ports only', () => {
    const tasks = [
      task({ id: 'A', wave: 1, devPort: 5200 }),
      task({ id: 'B', wave: 1 }),
      task({ id: 'C', wave: 1, devPort: 5202 }),
    ];
    assert.deepEqual(usedDevPorts(tasks).sort(), [5200, 5202]);
  });
});
