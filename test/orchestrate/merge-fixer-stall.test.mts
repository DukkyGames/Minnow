/**
 * Regression tests for merge-fixer stream-end finalize and vanished-merge-state guard.
 *
 * Part 2: fixer completion is report-driven on stream-end (triggerFixerStallReconcileForTests
 * injects board_report then simulates stream-end).
 * Part 3 / Failure B: startMergeConflictFixer skips spawning a fixer when MERGE_HEAD
 * is already gone and the branch is already merged.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  enqueueMergeCompletedTaskWorktreeForTests,
  releaseLaunchSlotForTests,
  startMergeConflictFixer,
  triggerFixerStallReconcileForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = 'grp_22222222-2222-2222-2222-222222222222';
const FIXER_CHAT_ID = '66666666-6666-6666-6666-666666666666';
const STALE_FIXER_CHAT_ID = '77777777-7777-7777-7777-777777777777';
const TASK_BRANCH = 'minnow/board/W1-B';
const SIBLING_BRANCH = 'minnow/board/W1-C';

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

function makeFixerChat(): Chat {
  return {
    id: FIXER_CHAT_ID,
    name: 'Fix merge W1-B',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Resolve merge conflict' },
      { role: 'assistant', content: 'Resolved and committed with git commit --no-edit.' },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W1-B',
  };
}

const INTEGRATION_BRANCH = 'minnow/integration/grp_22222222';

function makeGroup(): ChatGroup {
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Board',
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
        id: 'W1-B',
        title: 'Feature B',
        wave: 'W1',
        category: 'build',
        build: 'Add feature B',
        test: 'Run tests',
      },
    ],
    waves: [{ id: 'W1', status: 'in_progress' }],
  });
  group.orchestrateBoard!.integrationBranch = INTEGRATION_BRANCH;
  return group;
}

function seedMergingTask(
  group: ChatGroup,
  fixerChat: Chat,
  opts: { fixerAttempts?: number } = {},
): { group: ChatGroup; planner: Chat; fixerChat: Chat } {
  const planner = makePlanner();
  updateTask(
    group,
    'W1-B',
    {
      status: 'merging',
      fixerChatId: FIXER_CHAT_ID,
      worktreeBranch: TASK_BRANCH,
      mergePreSha: 'deadbeef',
      ...(opts.fixerAttempts !== undefined ? { fixerAttempts: opts.fixerAttempts } : {}),
    },
    planner,
  );
  setSessionStateForTests({
    chats: [planner, fixerChat],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  return { group, planner, fixerChat };
}

/**
 * Stub globalThis.fetch for /api/worktree calls.  Routes by the `op` field in
 * the POST body; returns the matching response or { ok: false, error: 'not_mocked' }.
 * Returns a restore function.
 */
function mockWorktreeOps(responses: Record<string, unknown>): () => void {
  const saved = globalThis.fetch;
  // @ts-ignore — test-only replacement
  globalThis.fetch = async (_url: unknown, opts?: { body?: unknown }) => {
    let op = '';
    try {
      op = (JSON.parse(opts?.body as string) as { op?: string }).op ?? '';
    } catch {
      /* ignore */
    }
    const payload = op in responses ? responses[op] : { ok: false, error: 'not_mocked' };
    return { ok: true, json: async () => payload };
  };
  return () => {
    globalThis.fetch = saved;
  };
}

describe('merge-fixer stall recovery (Part 2)', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    setLocalServerAvailableForTests(false);
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('stream-end with pass report advances task to complete when merge is verified', async () => {
    const group = makeGroup();
    const fixerChat = makeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: true },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    await triggerFixerStallReconcileForTests(group, planner, 'W1-B', {
      boardReport: { outcome: 'pass', summary: 'Merge committed' },
    });

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    assert.equal(task.status, 'complete', 'task should advance to complete on stream-end');
    assert.equal(task.fixerChatId, undefined, 'fixerChatId cleared on complete');
  });

  test('stream-end without report increments fixerAttempts and re-queues fixer when branch not merged', async () => {
    const group = makeGroup();
    const fixerChat = makeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat, { fixerAttempts: 0 });

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: false },
      restore_integration: { ok: true },
      // Re-merge produces a fresh conflict → retry fixer
      merge: {
        ok: false,
        conflict: true,
        conflictedFiles: ['src/foo.ts'],
        integrationSha: 'aabbccdd',
      },
      // For the re-spawned startMergeConflictFixer call
      ensure_integration: { ok: true, path: '/tmp/fake-integration' },
      merge_in_progress: { ok: true, inProgress: true },
    });

    await triggerFixerStallReconcileForTests(group, planner, 'W1-B');

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    // Task should still be merging with attempt counter incremented (fixer re-queued).
    assert.equal(task.status, 'merging', 'task should remain merging while retry is queued');
    assert.equal(task.fixerAttempts, 1, 'fixerAttempts should be incremented to 1');
  });

  test('stream-end without report completes task when re-merge succeeds on retry', async () => {
    const group = makeGroup();
    const fixerChat = makeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat, { fixerAttempts: 0 });

    restoreFetch = mockWorktreeOps({
      // Initial check says not merged → enters retry path.
      check_merged: { ok: true, merged: false },
      restore_integration: { ok: true },
      // Re-merge succeeds cleanly (conflict resolved / integration advanced).
      merge: { ok: true, integrationSha: 'feedface' },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    await triggerFixerStallReconcileForTests(group, planner, 'W1-B');

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    assert.equal(task.status, 'complete', 'successful re-merge should complete the task, not block it');
    assert.equal(task.fixerChatId, undefined, 'fixerChatId cleared on complete');
    assert.equal(task.fixerAttempts, undefined, 'fixerAttempts cleared on complete');
  });
});

describe('vanished-merge-state guard — Failure B (Part 3)', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    setLocalServerAvailableForTests(false);
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('startMergeConflictFixer skips fixer chat when MERGE_HEAD vanished and branch already merged', async () => {
    const group = makeGroup();
    const planner = makePlanner();
    // Task starts in 'merging' (retry context); no fixer yet.
    updateTask(group, 'W1-B', { status: 'merging', worktreeBranch: TASK_BRANCH, mergePreSha: 'aabbccdd' }, planner);
    setSessionStateForTests({
      chats: [planner],
      groups: [group],
      activeChatId: PLANNER_ID,
    });

    restoreFetch = mockWorktreeOps({
      ensure_integration: { ok: true, path: '/tmp/fake-integration' },
      // Part 3: MERGE_HEAD is gone
      merge_in_progress: { ok: true, inProgress: false },
      // Branch was already merged
      check_merged: { ok: true, merged: true },
      // finalizeMergeFixerOnStreamEnd calls these
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    await startMergeConflictFixer(group, task, planner, ['src/conflict.ts'], 'aabbccdd');

    const taskAfter = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    assert.equal(taskAfter.status, 'complete', 'task should complete without spawning a fixer chat');
    assert.equal(taskAfter.fixerChatId, undefined, 'no fixer chat should be created');
  });
});

describe('dead fixer does not block sibling merge (Fix 1)', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    releaseLaunchSlotForTests(STALE_FIXER_CHAT_ID);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    setLocalServerAvailableForTests(false);
    releaseLaunchSlotForTests(STALE_FIXER_CHAT_ID);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('stale non-streaming fixer does not block enqueueMergeCompletedTaskWorktree', async () => {
    const planner = makePlanner();
    const group: ChatGroup = {
      id: GROUP_ID,
      name: 'Board',
      workspacePath: '/tmp/ws',
      collapsed: false,
      order: 0,
      plannerChatId: PLANNER_ID,
      orchestratePlanPath: 'documentation/plans/test.md',
      viewMode: 'board',
    };
    initBoard(group, planner, {
      planPath: 'documentation/plans/test.md',
      tasks: [
        {
          id: 'W1-B',
          title: 'Feature B',
          wave: 'W1',
          category: 'build',
          build: 'Add feature B',
          test: 'Run tests',
        },
        {
          id: 'W1-C',
          title: 'Feature C',
          wave: 'W1',
          category: 'build',
          build: 'Add feature C',
          test: 'Run tests',
        },
      ],
      waves: [{ id: 'W1', status: 'in_progress' }],
    });
    group.orchestrateBoard!.integrationBranch = INTEGRATION_BRANCH;

    const staleFixerChat: Chat = {
      id: STALE_FIXER_CHAT_ID,
      name: 'Stale fixer',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      history: [{ role: 'assistant', content: 'Stalled mid-merge' }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: GROUP_ID,
      boardTaskId: 'W1-B',
    };

    updateTask(
      group,
      'W1-B',
      {
        status: 'merging',
        fixerChatId: STALE_FIXER_CHAT_ID,
        worktreeBranch: TASK_BRANCH,
        mergePreSha: 'deadbeef',
      },
      planner,
    );
    updateTask(
      group,
      'W1-C',
      {
        status: 'testing',
        worktreeBranch: SIBLING_BRANCH,
        testVerdict: 'pass',
        testSummary: 'ok',
      },
      planner,
    );

    setSessionStateForTests({
      chats: [planner, staleFixerChat],
      groups: [group],
      activeChatId: PLANNER_ID,
    });

    restoreFetch = mockWorktreeOps({
      merge: { ok: true, integrationSha: 'cafebabe' },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    const sibling = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-C')!;
    const mergePromise = enqueueMergeCompletedTaskWorktreeForTests(group, sibling, planner);
    const raced = await Promise.race([
      mergePromise.then((result) => ({ kind: 'resolved' as const, result })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), 2_000),
      ),
    ]);

    assert.equal(raced.kind, 'resolved', 'sibling merge should not hang on stale fixer');
    if (raced.kind === 'resolved') {
      assert.equal(raced.result.outcome, 'merged');
    }
  });
});
