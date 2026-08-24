import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { normalizeWorkspacePath } from '../../src/lib/normalize-workspace-path.ts';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import {
  allocateDevPort,
  allocateTaskPorts,
  boardIntegrationBranch,
  integrationWorktreePathFromSlotPath,
  isIsolationActive,
  resolveBoardIntegrationWorktreePath,
  resolveChatToolWorkspaceRoot,
  resolveChatWorktreeRoot,
  resolveIsolationMode,
  sanitizeRefFragment,
  tasksSharingSlot,
  taskWorktreeBranch,
  taskWorktreeSlot,
  deriveBoardWorktreeSlug,
  usedDevPorts,
  waveWorktreeBranch,
  worktreeBranchFor,
  worktreeSlotId,
} from '../../src/state/worktree-isolation.ts';
import type { BoardTask, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';

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

afterEach(() => {
  resetAutopilotMetaCache();
});

describe('resolveIsolationMode', () => {
  test('explicit override wins over the derived default', () => {
    assert.equal(
      resolveIsolationMode(board({ isolationMode: 'per-wave', maxConcurrentTasks: 1 })),
      'per-wave',
    );
    assert.equal(
      resolveIsolationMode(board({ isolationMode: 'off', maxConcurrentTasks: 4 })),
      'off',
    );
    assert.equal(
      resolveIsolationMode(board({ isolationMode: 'per-board', maxConcurrentTasks: 4 })),
      'per-board',
    );
  });

  test('concurrency 1 derives per-board; >1 derives per-task', () => {
    assert.equal(resolveIsolationMode(board({ maxConcurrentTasks: 1 })), 'per-board');
    assert.equal(
      resolveIsolationMode(board({ maxConcurrentTasks: 1, handsOff: true })),
      'per-board',
    );
    assert.equal(resolveIsolationMode(board({ maxConcurrentTasks: 3 })), 'per-task');
    assert.equal(resolveIsolationMode(board({ handsOff: true })), 'per-task');
  });

  test('no board concurrency falls back to the global default', () => {
    setAutopilotMetaForTests({ maxConcurrentTasks: 1 });
    assert.equal(resolveIsolationMode(board({})), 'per-board');
    setAutopilotMetaForTests({ maxConcurrentTasks: 5 });
    assert.equal(resolveIsolationMode(board({})), 'per-task');
  });

  test('global isolation default applies when board has no override', () => {
    setAutopilotMetaForTests({ isolationMode: 'per-wave' });
    assert.equal(resolveIsolationMode(board({ maxConcurrentTasks: 1 })), 'per-wave');
    setAutopilotMetaForTests({ isolationMode: 'off' });
    assert.equal(resolveIsolationMode(board({ maxConcurrentTasks: 4 })), 'off');
  });

  test('global auto keeps deriving from concurrency', () => {
    setAutopilotMetaForTests({ isolationMode: 'auto' });
    assert.equal(resolveIsolationMode(board({ maxConcurrentTasks: 4 })), 'per-task');
    assert.equal(resolveIsolationMode(board({ maxConcurrentTasks: 1 })), 'per-board');
  });

  test('null board is off; isIsolationActive mirrors resolution', () => {
    assert.equal(resolveIsolationMode(null), 'off');
    assert.equal(isIsolationActive(null), false);
    assert.equal(isIsolationActive(board({ maxConcurrentTasks: 4 })), true);
    // Sequential boards are isolated now — that is the whole point of per-board.
    assert.equal(isIsolationActive(board({ maxConcurrentTasks: 1 })), true);
    assert.equal(isIsolationActive(board({ isolationMode: 'off' })), false);
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

  test('branch names are readable, stable and namespaced per board', () => {
    assert.equal(boardIntegrationBranch('checkout-flow'), 'minnow/board/checkout-flow/integration');
    assert.equal(
      taskWorktreeBranch('checkout-flow', { id: 'T-2', title: 'Add Login Form' }),
      'minnow/board/checkout-flow/T-2-add-login-form',
    );
    assert.equal(
      waveWorktreeBranch('checkout-flow', 'W1'),
      'minnow/board/checkout-flow/wave-W1',
    );
  });

  test('every board branch keeps the minnow/board/ prefix git-ops matches on', () => {
    const t = task({ id: 'T1', wave: 1, title: 'Do the thing' });
    for (const branch of [
      boardIntegrationBranch('slug'),
      taskWorktreeBranch('slug', t),
      waveWorktreeBranch('slug', 1),
      worktreeBranchFor('per-board', 'slug', t),
    ]) {
      assert.ok(branch?.startsWith('minnow/board/'), branch ?? '(null)');
    }
  });

  test('taskWorktreeSlot degrades gracefully on empty and oversized titles', () => {
    assert.equal(taskWorktreeSlot({ id: 'T1', title: '   ' }), 'T1');
    const slot = taskWorktreeSlot({ id: 'T1', title: 'x'.repeat(200) });
    assert.equal(slot.length, 64);
    assert.ok(slot.startsWith('T1-'));
    assert.ok(!slot.endsWith('-'));
  });

  test('integrationWorktreePathFromSlotPath derives integration slot path', () => {
    const boardDir = 'C:/repo/.minnow/worktrees/minnow-abc/board-1';
    // Survives the new free-form slot names as well as the legacy task-/wave- ones.
    for (const slot of ['task-T1', 'wave-W1', 'T1-add-login-form', 'W1']) {
      assert.equal(
        integrationWorktreePathFromSlotPath(`${boardDir}/${slot}`),
        `${boardDir}/integration`,
      );
    }
    assert.equal(
      integrationWorktreePathFromSlotPath(`${boardDir}/integration`),
      `${boardDir}/integration`,
    );
    assert.equal(integrationWorktreePathFromSlotPath('C:/other/path'), undefined);
    // Regular-chat worktrees (MIN-276) are not board slots.
    assert.equal(
      integrationWorktreePathFromSlotPath('C:/repo/.minnow/worktrees/minnow-abc/chat/c1'),
      undefined,
    );
  });

  test('worktreeSlotId / worktreeBranchFor follow the mode', () => {
    const t = task({ id: 'T-2', wave: 'W1', title: 'Ship it' });
    assert.equal(worktreeSlotId('per-task', t), 'T-2-ship-it');
    assert.equal(worktreeSlotId('per-wave', t), 'wave-W1');
    assert.equal(worktreeSlotId('per-board', t), 'integration');
    assert.equal(worktreeSlotId('off', t), null);
    assert.equal(worktreeBranchFor('per-task', 'g', t), 'minnow/board/g/T-2-ship-it');
    assert.equal(worktreeBranchFor('per-wave', 'g', t), 'minnow/board/g/wave-W1');
    // Per-board: the board branch *is* the integration branch, so there is no merge.
    assert.equal(worktreeBranchFor('per-board', 'g', t), 'minnow/board/g/integration');
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
  test('per-board shares with every task on the board', () => {
    assert.deepEqual(tasksSharingSlot('per-board', a, all).map((t) => t.id), ['A', 'B', 'C']);
  });
  test('off shares with nothing', () => {
    assert.deepEqual(tasksSharingSlot('off', a, all), []);
  });
});

describe('deriveBoardWorktreeSlug', () => {
  function group(patch: Partial<ChatGroup> = {}): ChatGroup {
    return {
      id: 'grp-9f3a2b',
      name: '',
      workspacePath: 'C:/repo',
      collapsed: false,
      order: 0,
      createdAt: 0,
      orchestratePlanPath: 'documentation/plans/checkout-flow.md',
      orchestrateBoard: board({ maxConcurrentTasks: 3 }),
      ...patch,
    } as ChatGroup;
  }

  test('derives a readable slug from the plan file name', () => {
    assert.equal(deriveBoardWorktreeSlug(group()), 'checkout-flow');
  });

  test('falls back to the folder name, then to "board"', () => {
    const named = group({ orchestratePlanPath: undefined, name: 'Payments Rework' });
    assert.equal(deriveBoardWorktreeSlug(named), 'payments-rework');
    const bare = group({ orchestratePlanPath: undefined, name: '' });
    assert.equal(deriveBoardWorktreeSlug(bare), 'board');
  });

  test('de-dupes against sibling slugs', () => {
    assert.equal(deriveBoardWorktreeSlug(group(), ['checkout-flow']), 'checkout-flow-2');
    assert.equal(
      deriveBoardWorktreeSlug(group(), ['checkout-flow', 'checkout-flow-2']),
      'checkout-flow-3',
    );
  });

  test('a frozen slug survives a board rename', () => {
    const g = group();
    g.orchestrateBoard!.worktreeSlug = 'checkout-flow';
    g.name = 'Something Else Entirely';
    g.orchestratePlanPath = 'documentation/plans/renamed.md';
    assert.equal(deriveBoardWorktreeSlug(g), 'checkout-flow');
  });

  test('boards that already provisioned worktrees keep the opaque group id', () => {
    const withBranch = group();
    withBranch.orchestrateBoard!.integrationBranch = 'minnow/board/grp-9f3a2b/integration';
    assert.equal(deriveBoardWorktreeSlug(withBranch), 'grp-9f3a2b');

    const withPath = group();
    withPath.orchestrateBoard!.tasks = [
      task({ id: 'T1', wave: 1, worktreePath: 'C:/w/grp-9f3a2b/task-T1' }),
    ];
    assert.equal(deriveBoardWorktreeSlug(withPath), 'grp-9f3a2b');
  });
});

describe('resolveBoardIntegrationWorktreePath', () => {
  const integrationBranch = 'minnow/board/g/integration';
  const boardDir = 'C:/repo/.minnow/worktrees/minnow-abc/g';
  const integrationPath = `${boardDir}/integration`;
  const taskPath = `${boardDir}/task-T1`;

  function boardGroup(tasks: BoardTask[]): ChatGroup {
    return {
      id: 'g',
      name: 'Board',
      workspacePath: 'C:/repo',
      collapsed: false,
      order: 0,
      createdAt: 0,
      viewMode: 'board',
      orchestrateBoard: board({
        maxConcurrentTasks: 3,
        integrationBranch,
        tasks,
      }),
    };
  }

  test('returns integration path from task worktree when isolation is active', () => {
    const group = boardGroup([
      task({
        id: 'T1',
        wave: 1,
        status: 'in_progress',
        worktreePath: taskPath,
      }),
    ]);
    assert.equal(resolveBoardIntegrationWorktreePath(group), integrationPath);
  });

  test('returns undefined when isolation is off or integration is not provisioned', () => {
    const group = boardGroup([
      task({ id: 'T1', wave: 1, status: 'planned', worktreePath: taskPath }),
    ]);
    group.orchestrateBoard!.isolationMode = 'off';
    assert.equal(resolveBoardIntegrationWorktreePath(group), undefined);

    delete group.orchestrateBoard!.isolationMode;
    delete group.orchestrateBoard!.integrationBranch;
    assert.equal(resolveBoardIntegrationWorktreePath(group), undefined);
  });

  test('falls back to chat worktreeRoot on integration branch', () => {
    const group = boardGroup([]);
    assert.equal(
      resolveBoardIntegrationWorktreePath(group, [
        {
          id: 'fixer',
          model: 'm',
          history: [],
          boardGroupId: 'g',
          worktreeRoot: integrationPath,
          gitBranch: integrationBranch,
        },
      ]),
      integrationPath,
    );
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

describe('resolveChatToolWorkspaceRoot', () => {
  test('uses worktree when present', () => {
    const wt = 'C:/wt/task';
    assert.equal(
      resolveChatToolWorkspaceRoot(
        {
          boardGroupId: 'g',
          boardTaskId: 'T1',
          workspacePath: 'C:/project',
          worktreeRoot: wt,
        },
        [],
      ),
      wt,
    );
  });

  test('falls back to chat workspace for board members without worktree', () => {
    assert.equal(
      resolveChatToolWorkspaceRoot(
        {
          boardGroupId: 'g',
          boardTaskId: 'T1',
          workspacePath: 'C:/project',
        },
        [],
      ),
      'C:/project',
    );
  });

  test('returns undefined for non-board chats without worktree', () => {
    assert.equal(
      resolveChatToolWorkspaceRoot({ workspacePath: 'C:/project' }, []),
      undefined,
    );
  });

  test('uses desktop sandbox workspace for desktop chats without board linkage', () => {
    const desktopWs = 'C:/Users/me/.minnow/workspace';
    assert.equal(
      resolveChatToolWorkspaceRoot({ workspacePath: desktopWs }, []),
      normalizeWorkspacePath(desktopWs),
    );
  });

  test('uses chats sandbox workspace for legacy assistant chats', () => {
    assert.equal(
      resolveChatToolWorkspaceRoot(
        { workspacePath: '/home/user/.minnow/chats' },
        [],
      ),
      '/home/user/.minnow/chats',
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
  test('usedDevPorts collects client and API ports', () => {
    const tasks = [
      task({ id: 'A', wave: 1, devPort: 5200, apiPort: 5300 }),
      task({ id: 'B', wave: 1 }),
      task({ id: 'C', wave: 1, devPort: 5202 }),
    ];
    assert.deepEqual(usedDevPorts(tasks).sort(), [5200, 5202, 5300]);
  });
  test('allocateTaskPorts reserves non-overlapping client and API ports', () => {
    const a = allocateTaskPorts(5200, []);
    assert.equal(a.devPort, 5200);
    assert.equal(a.apiPort, 5300);
    const b = allocateTaskPorts(5200, usedDevPorts([task({ id: 'X', wave: 1, ...a })]));
    assert.equal(b.devPort, 5201);
    assert.equal(b.apiPort, 5301);
    const used = new Set([...usedDevPorts([task({ id: 'X', wave: 1, ...a }), task({ id: 'Y', wave: 1, ...b })])]);
    assert.equal(used.has(a.devPort), true);
    assert.equal(used.has(a.apiPort), true);
    assert.equal(used.has(b.devPort), true);
    assert.equal(used.has(b.apiPort), true);
    assert.equal(a.devPort, b.devPort - 1);
  });
});
