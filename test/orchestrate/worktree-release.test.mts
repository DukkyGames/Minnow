/**
 * Phase 2 worktree lifecycle: a task's worktree directory is dropped once its
 * branch lands in integration, the branch survives, and a later requeue can
 * recreate the slot from that surviving branch.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  enqueueMergeCompletedTaskWorktreeForTests,
  ensureTaskWorktreeForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '32222222-2222-2222-2222-222222222222';
const GROUP_ID = 'grp_32222222-2222-2222-2222-222222222222';
const INTEGRATION_BRANCH = 'minnow/board/test-board/integration';
const TASK_BRANCH = 'minnow/board/test-board/W1-A-feature-a';
const TASK_SLOT = 'W1-A-feature-a';
const SLOT_PATH = '/tmp/worktrees/repo-abc/test-board/W1-A-feature-a';
const INTEGRATION_PATH = '/tmp/worktrees/repo-abc/test-board/integration';

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

/** Board pinned to per-task isolation (the only mode that releases worktrees). */
function makeGroup(): { group: ChatGroup; planner: Chat } {
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Test Board',
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
      {
        id: 'W1-A',
        title: 'Feature A',
        wave: 'W1',
        category: 'build',
        build: 'Add feature A',
        test: 'Run tests',
      },
    ],
    waves: [{ id: 'W1', status: 'in_progress' }],
  });
  const board = group.orchestrateBoard!;
  board.integrationBranch = INTEGRATION_BRANCH;
  board.worktreeSlug = 'test-board';
  board.maxConcurrentTasks = 2;
  board.isolationMode = 'per-task';
  return { group, planner };
}

/** Route /api/worktree by `op`, recording every call for assertions. */
function mockWorktreeOps(responses: Record<string, unknown>): {
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
      /* non-JSON bodies are teardown pings, not worktree ops */
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

describe('board worktree release on merge (Phase 2)', () => {
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

  test('verified merge removes the worktree directory and keeps the branch', async () => {
    const { group, planner } = makeGroup();
    updateTask(
      group,
      'W1-A',
      {
        status: 'testing',
        worktreeBranch: TASK_BRANCH,
        worktreePath: SLOT_PATH,
        devPort: 5200,
        apiPort: 5300,
      },
      planner,
    );
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    const mock = mockWorktreeOps({
      commit: { ok: true },
      merge: { ok: true, integrationSha: 'abc123' },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
      remove: { ok: true, path: SLOT_PATH },
    });
    restoreFetch = mock.restore;

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    const res = await enqueueMergeCompletedTaskWorktreeForTests(group, task, planner);
    assert.equal(res.outcome, 'merged');

    const removeCall = mock.calls.find((c) => c.op === 'remove');
    assert.ok(removeCall, 'the merged task worktree should be removed');
    assert.equal(removeCall.args.slotId, TASK_SLOT);

    const after = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(after.worktreePath, undefined, 'worktreePath is cleared');
    assert.equal(
      after.worktreeBranch,
      TASK_BRANCH,
      'the branch is kept so the work stays inspectable',
    );
    assert.equal(after.devPort, undefined, 'dev port released');
    assert.equal(after.apiPort, undefined, 'api port released');

    const log = group.orchestrateBoard!.log ?? [];
    assert.ok(
      log.some((e) => e.type === 'worktree_released' && e.taskId === 'W1-A'),
      'a worktree_released event balances the earlier allocation',
    );
  });

  test('a failed removal keeps worktreePath pointing at the surviving directory', async () => {
    const { group, planner } = makeGroup();
    updateTask(
      group,
      'W1-A',
      { status: 'testing', worktreeBranch: TASK_BRANCH, worktreePath: SLOT_PATH },
      planner,
    );
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    restoreFetch = mockWorktreeOps({
      commit: { ok: true },
      merge: { ok: true, integrationSha: 'abc123' },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
      remove: { ok: false, error: 'worktree directory survived removal' },
    }).restore;

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    const res = await enqueueMergeCompletedTaskWorktreeForTests(group, task, planner);
    assert.equal(res.outcome, 'merged', 'a failed cleanup must not fail the merge');

    const after = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(
      after.worktreePath,
      SLOT_PATH,
      'an orphan directory must stay referenced, not be forgotten',
    );
  });

  test('per-board isolation never removes the shared integration checkout', async () => {
    const { group, planner } = makeGroup();
    const board = group.orchestrateBoard!;
    board.isolationMode = 'per-board';
    board.maxConcurrentTasks = 1;
    updateTask(
      group,
      'W1-A',
      {
        status: 'testing',
        worktreeBranch: INTEGRATION_BRANCH,
        worktreePath: INTEGRATION_PATH,
      },
      planner,
    );
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    const mock = mockWorktreeOps({ commit: { ok: true } });
    restoreFetch = mock.restore;

    const task = board.tasks.find((t) => t.id === 'W1-A')!;
    const res = await enqueueMergeCompletedTaskWorktreeForTests(group, task, planner);
    assert.equal(res.outcome, 'merged');
    assert.equal(
      mock.calls.some((c) => c.op === 'remove'),
      false,
      'the integration checkout is where the next task works',
    );
  });

  test('requeue after cleanup recreates the slot from the surviving branch', async () => {
    const { group, planner } = makeGroup();
    // Post-cleanup shape: branch remembered, directory gone.
    updateTask(
      group,
      'W1-A',
      { status: 'planned', worktreeBranch: TASK_BRANCH, worktreePath: undefined },
      planner,
    );
    setSessionStateForTests({ chats: [planner], groups: [group], activeChatId: PLANNER_ID });

    const mock = mockWorktreeOps({
      ensure_integration: { ok: true, path: INTEGRATION_PATH },
      create: { ok: true, path: SLOT_PATH },
    });
    restoreFetch = mock.restore;

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    const path = await ensureTaskWorktreeForTests(group, task, planner);
    assert.equal(path, SLOT_PATH);

    const createCall = mock.calls.find((c) => c.op === 'create');
    assert.ok(createCall, 'the slot is recreated');
    assert.equal(createCall.args.slotId, TASK_SLOT);
    assert.equal(
      createCall.args.branch,
      TASK_BRANCH,
      'it checks out the surviving branch rather than minting a new one',
    );

    const after = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(after.worktreePath, SLOT_PATH);
  });
});
