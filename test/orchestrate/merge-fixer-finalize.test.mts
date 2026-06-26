/**
 * Merge-fixer finalize idempotency, stream-end drain, and unmatched stream-end recovery.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  clearTaskQueuesForTests,
  enqueueTaskForTests,
  finalizeMergeFixerOnStreamEndForTests,
  getTaskQueueForTests,
  releaseLaunchSlotForTests,
  simulateUnmatchedFixerStreamEndForTests,
  triggerFixerStallReconcileForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import type { BoardTask, Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = 'grp_22222222-2222-2222-2222-222222222222';
const FIXER_CHAT_ID = '66666666-6666-6666-6666-666666666666';
const TASK_BRANCH = 'minnow/board/W1-A';

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
    name: 'Fix merge W1-A',
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
    boardTaskId: 'W1-A',
  };
}

const INTEGRATION_BRANCH = 'minnow/integration/grp_22222222';

function makeGroup(tasks: BoardTask[]): ChatGroup {
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
    tasks,
    waves: [{ id: 'W1', status: 'in_progress' }],
  });
  group.orchestrateBoard!.integrationBranch = INTEGRATION_BRANCH;
  group.orchestrateBoard!.executionMode = 'auto';
  group.orchestrateBoard!.autoRunning = true;
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
    'W1-A',
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

function countFixerRetries(group: ChatGroup, taskId = 'W1-A'): number {
  return (
    group.orchestrateBoard?.log?.filter(
      (e) =>
        e.type === 'task_retry' &&
        e.taskId === taskId &&
        e.detail?.attemptKind === 'fixer',
    ).length ?? 0
  );
}

describe('merge-fixer finalize idempotency', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    clearTaskQueuesForTests();
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    setLocalServerAvailableForTests(false);
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
    clearTaskQueuesForTests();
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('concurrent finalize calls log only one fixer retry', async () => {
    const group = makeGroup([
      {
        id: 'W1-A',
        title: 'Feature A',
        wave: 'W1',
        category: 'build',
        build: 'Add feature A',
        test: 'Run tests',
      },
    ]);
    const fixerChat = makeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat, { fixerAttempts: 0 });
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: false },
      restore_integration: { ok: true },
      merge: {
        ok: false,
        conflict: true,
        conflictedFiles: ['src/foo.ts'],
        integrationSha: 'aabbccdd',
      },
      ensure_integration: { ok: true, path: '/tmp/fake-integration' },
      merge_in_progress: { ok: true, inProgress: true },
    });

    const p1 = finalizeMergeFixerOnStreamEndForTests(group, task, planner);
    const p2 = finalizeMergeFixerOnStreamEndForTests(group, task, planner);
    await Promise.all([p1, p2]);

    const taskAfter = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(countFixerRetries(group), 1, 'only one fixer retry should be logged');
    assert.equal(taskAfter.fixerAttempts, 1);
    assert.equal(taskAfter.status, 'merging');
  });

  test('stream-end path completes task and drains queued sibling', async () => {
    const group = makeGroup([
      {
        id: 'W1-A',
        title: 'Feature A',
        wave: 'W1',
        category: 'build',
        build: 'Add feature A',
        test: 'Run tests',
      },
      {
        id: 'W1-B',
        title: 'Feature B',
        wave: 'W1',
        category: 'build',
        build: 'Add feature B',
        test: 'Run tests',
        status: 'planned',
      },
    ]);
    const fixerChat = makeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);
    enqueueTaskForTests(GROUP_ID, 'W1-B');
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), ['W1-B']);

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: true },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    await triggerFixerStallReconcileForTests(group, planner, 'W1-A');

    const taskA = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(taskA.status, 'complete');
    assert.equal(getTaskQueueForTests(GROUP_ID).length, 0, 'queue drained after fixer complete');
  });

  test('unmatched stream-end drains queue when fixerChatId was cleared early', async () => {
    const group = makeGroup([
      {
        id: 'W1-A',
        title: 'Feature A',
        wave: 'W1',
        category: 'build',
        build: 'Add feature A',
        test: 'Run tests',
        status: 'complete',
      },
      {
        id: 'W1-B',
        title: 'Feature B',
        wave: 'W1',
        category: 'build',
        build: 'Add feature B',
        test: 'Run tests',
        status: 'planned',
      },
    ]);
    const planner = makePlanner();
    setSessionStateForTests({
      chats: [planner],
      groups: [group],
      activeChatId: PLANNER_ID,
    });
    enqueueTaskForTests(GROUP_ID, 'W1-B');
    assert.deepEqual(getTaskQueueForTests(GROUP_ID), ['W1-B']);

    await simulateUnmatchedFixerStreamEndForTests(group, planner, FIXER_CHAT_ID);

    assert.equal(
      getTaskQueueForTests(GROUP_ID).length,
      0,
      'unmatched fixer stream-end should still drain while board is running',
    );
  });
});
