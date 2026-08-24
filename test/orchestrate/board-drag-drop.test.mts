/**
 * Phase 3.1/3.2: kanban drop → status transition mapping, the running-card
 * confirm, and Requeue vs Reset.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  boardTaskDragDisrupts,
  isBoardTaskDraggable,
  resolveBoardDropAction,
  type KanbanColumnId,
} from '../../src/ui/orchestrate-board-dnd.ts';
import {
  requeueBoardTask,
  resetBoardTask,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import { acquirePipelineHold } from '../../src/state/orchestrate-pipeline-holds.ts';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '42222222-2222-2222-2222-222222222222';
const GROUP_ID = 'grp_42222222-2222-2222-2222-222222222222';

function makePlanner(): Chat {
  return {
    id: PLANNER_ID,
    name: 'Planner',
    workspacePath: '/tmp/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    orchestratePlanPath: 'documentation/plans/test.md',
    boardGroupId: GROUP_ID,
  };
}

function makeGroup(): { group: ChatGroup; planner: Chat } {
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Drag Board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: 'documentation/plans/test.md',
    viewMode: 'board',
  };
  const planner = makePlanner();
  initBoard(group, planner, {
    planPath: 'documentation/plans/test.md',
    tasks: [
      { id: 'W1-A', title: 'Feature A', wave: 'W1', category: 'build', build: 'Do A' },
    ],
    waves: [{ id: 'W1', status: 'in_progress' }],
  });
  return { group, planner };
}

function taskWithStatus(status: BoardTaskStatus): BoardTask {
  return { id: 'W1-A', title: 'Feature A', wave: 'W1', category: 'build', status };
}

describe('kanban drop → status transition (Phase 3.1)', () => {
  const cases: Array<{
    from: BoardTaskStatus;
    column: KanbanColumnId;
    expected: ReturnType<typeof resolveBoardDropAction>;
    why: string;
  }> = [
    { from: 'planned', column: 'in_progress', expected: 'start', why: 'Planned → In Progress starts the task' },
    { from: 'blocked', column: 'in_progress', expected: 'start', why: 'a blocked card can be started by hand' },
    { from: 'in_progress', column: 'testing', expected: 'test', why: 'In Progress → Testing runs the tester' },
    { from: 'testing', column: 'complete', expected: 'complete', why: 'any → Complete marks it complete' },
    { from: 'in_progress', column: 'complete', expected: 'complete', why: 'any → Complete, not only from Testing' },
    { from: 'complete', column: 'planned', expected: 'requeue', why: 'Complete → Planned is a real requeue' },
    { from: 'failed', column: 'planned', expected: 'requeue', why: 'failed requeues rather than bare status move' },
    { from: 'quarantined', column: 'planned', expected: 'requeue', why: 'quarantined requeues' },
    { from: 'blocked', column: 'planned', expected: 'plan', why: 'blocked was never terminal, so plain move' },
    { from: 'planned', column: 'planned', expected: null, why: 'same lane is a no-op' },
    { from: 'complete', column: 'complete', expected: null, why: 'same lane is a no-op' },
  ];

  for (const c of cases) {
    test(`${c.from} → ${c.column}: ${c.why}`, () => {
      assert.equal(resolveBoardDropAction(taskWithStatus(c.from), c.column), c.expected);
    });
  }

  test('merging cards are not draggable', () => {
    assert.equal(isBoardTaskDraggable(taskWithStatus('merging')), false);
    assert.equal(isBoardTaskDraggable(taskWithStatus('in_progress')), true);
  });

  test('a card holding a pipeline slot counts as disruptive', () => {
    const { group } = makeGroup();
    const board = group.orchestrateBoard!;
    const task = board.tasks[0]!;
    assert.equal(boardTaskDragDisrupts(task, group), false);
    acquirePipelineHold(board, task.id, 'merge');
    assert.equal(
      boardTaskDragDisrupts(task, group),
      true,
      'moving a task mid-merge has to be confirmed first',
    );
  });
});

describe('requeue vs reset (Phase 3.2)', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    setLocalServerAvailableForTests(false);
    if (prevMinnowTest === undefined) delete process.env.MINNOW_TEST;
    else process.env.MINNOW_TEST = prevMinnowTest;
    setSessionStateForTests(null);
  });

  function mockWorktree(responses: Record<string, unknown>): {
    restore: () => void;
    calls: Array<{ op: string; args: Record<string, unknown> }>;
  } {
    const saved = globalThis.fetch;
    const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
    // @ts-ignore — test-only replacement
    globalThis.fetch = async (_url: unknown, opts?: { body?: unknown }) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(opts?.body as string) as Record<string, unknown>;
      } catch {
        /* teardown pings are not worktree ops */
      }
      const op = typeof parsed.op === 'string' ? parsed.op : '';
      if (op) calls.push({ op, args: parsed });
      const payload = op in responses ? responses[op] : { ok: false, error: 'not_mocked' };
      return { ok: true, json: async () => payload };
    };
    return {
      restore: () => {
        globalThis.fetch = saved;
      },
      calls,
    };
  }

  test('requeue on a failed task clears the retry budget and keeps the worktree', async () => {
    const { group, planner } = makeGroup();
    updateTask(
      group,
      'W1-A',
      {
        status: 'failed',
        buildAttempts: 3,
        testAttempts: 2,
        error: 'build blew up',
        worktreePath: '/tmp/wt/W1-A',
        worktreeBranch: 'minnow/board/b/W1-A',
      },
      planner,
    );
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    const mock = mockWorktree({});
    restoreFetch = mock.restore;

    await requeueBoardTask(group, 'W1-A', planner);

    const task = group.orchestrateBoard!.tasks[0]!;
    assert.equal(task.status, 'planned');
    assert.equal(task.buildAttempts, undefined, 'buildAttempts reset');
    assert.equal(task.testAttempts, undefined, 'testAttempts reset');
    assert.equal(task.error, undefined);
    assert.equal(task.worktreePath, '/tmp/wt/W1-A', 'requeue keeps the worktree');
    assert.equal(
      mock.calls.some((c) => c.op === 'remove'),
      false,
    );
  });

  test('reset removes the worktree and forgets the branch so it is recreated fresh', async () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    board.isolationMode = 'per-task';
    board.worktreeSlug = 'drag-board';
    updateTask(
      group,
      'W1-A',
      {
        status: 'failed',
        buildAttempts: 3,
        worktreePath: '/tmp/wt/W1-A-feature-a',
        worktreeBranch: 'minnow/board/drag-board/W1-A-feature-a',
        pendingBuildSeed: 'retry this',
      },
      planner,
    );
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    const mock = mockWorktree({ remove: { ok: true } });
    restoreFetch = mock.restore;

    await resetBoardTask(group, 'W1-A', planner);

    const task = group.orchestrateBoard!.tasks[0]!;
    assert.equal(task.status, 'planned');
    assert.equal(task.buildAttempts, undefined);
    assert.equal(task.worktreePath, undefined, 'worktree dropped');
    assert.equal(task.worktreeBranch, undefined, 'branch forgotten so a fresh one is minted');
    assert.equal(task.pendingBuildSeed, undefined, 'no stale seed replayed into the new worktree');

    const removeCall = mock.calls.find((c) => c.op === 'remove');
    assert.ok(removeCall, 'reset removes the slot');
    assert.equal(removeCall.args.slotId, 'W1-A-feature-a');
  });

  test('reset in per-board isolation never removes the shared checkout', async () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    board.isolationMode = 'per-board';
    board.integrationBranch = 'minnow/board/drag-board/integration';
    updateTask(
      group,
      'W1-A',
      {
        status: 'failed',
        worktreePath: '/tmp/wt/integration',
        worktreeBranch: board.integrationBranch,
      },
      planner,
    );
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    const mock = mockWorktree({ remove: { ok: true } });
    restoreFetch = mock.restore;

    await resetBoardTask(group, 'W1-A', planner);

    assert.equal(
      mock.calls.some((c) => c.op === 'remove'),
      false,
      'removing it would take the whole board with it',
    );
    assert.equal(group.orchestrateBoard!.tasks[0]!.status, 'planned');
  });

  test('reset refuses a task that is not recoverable', async () => {
    const { group, planner } = makeGroup();
    updateTask(group, 'W1-A', { status: 'in_progress' }, planner);
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    const mock = mockWorktree({ remove: { ok: true } });
    restoreFetch = mock.restore;

    await resetBoardTask(group, 'W1-A', planner);
    assert.equal(group.orchestrateBoard!.tasks[0]!.status, 'in_progress');
    assert.equal(mock.calls.length, 0);
  });
});
