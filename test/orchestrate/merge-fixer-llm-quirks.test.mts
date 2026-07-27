/**
 * Merge-fixer LLM misbehaviour — intended recovery when fixer prose/tools lie.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  buildMergeFixerSeedMessageForTests,
  clearTaskQueuesForTests,
  finalizeMergeFixerOnStreamEndForTests,
  releaseLaunchSlotForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import type { BoardTask, Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = 'grp_22222222-2222-2222-2222-222222222222';
const FIXER_CHAT_ID = '66666666-6666-6666-6666-666666666666';
const INTEGRATION_BRANCH = 'minnow/integration/grp_22222222';

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

function makeFixerChat(content: string): Chat {
  return {
    id: FIXER_CHAT_ID,
    name: 'Fix merge W1-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Resolve merge conflict' },
      { role: 'assistant', content },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W1-A',
  };
}

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
): { group: ChatGroup; planner: Chat; task: BoardTask } {
  const planner = makePlanner();
  updateTask(
    group,
    'W1-A',
    {
      status: 'merging',
      fixerChatId: FIXER_CHAT_ID,
      worktreeBranch: 'minnow/board/W1-A',
      mergePreSha: 'deadbeef',
      fixerAttempts: 0,
    },
    planner,
  );
  setSessionStateForTests({
    chats: [planner, fixerChat],
    groups: [group],
    activeChatId: PLANNER_ID,
  });
  const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
  return { group, planner, task };
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

describe('merge-fixer LLM quirks', () => {
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
    if (prevMinnowTest === undefined) delete process.env.MINNOW_TEST;
    else process.env.MINNOW_TEST = prevMinnowTest;
    setSessionStateForTests(null);
  });

  test('fixer prose-only resolved without board_report retries with verify context', async () => {
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
    const fixerChat = makeFixerChat('I think the conflict is resolved now.');
    const { planner, task } = seedMergingTask(group, fixerChat);

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

    await finalizeMergeFixerOnStreamEndForTests(group, task, planner);

    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'merging');
    assert.equal(updated.fixerAttempts, 1);
    assert.ok(updated.fixerChatId?.trim());
    const seed = buildMergeFixerSeedMessageForTests(updated, ['src/foo.ts'], {
      verifyFailureSummary: 'fixer ended without board_report pass',
      attemptNumber: 2,
      maxAttempts: 2,
    });
    assert.match(seed, /without board_report/i);
  });

  test('fixer board_report pass but check_merged false retries instead of completing', async () => {
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
    const fixerChat = makeFixerChat('Resolved and committed with git commit --no-edit.');
    const { planner, task } = seedMergingTask(group, fixerChat);
    updateTask(
      group,
      'W1-A',
      { boardReport: { outcome: 'pass', summary: 'Merge committed' } },
      planner,
    );

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

    await finalizeMergeFixerOnStreamEndForTests(group, task, planner);

    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'merging');
    assert.equal(updated.fixerAttempts, 1);
    assert.notEqual(updated.status, 'complete');
  });

  test('fixer board_report fail routes retry with failure summary', async () => {
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
    const fixerChat = makeFixerChat('Could not resolve conflict in src/foo.ts');
    const { planner, task } = seedMergingTask(group, fixerChat);
    updateTask(
      group,
      'W1-A',
      { boardReport: { outcome: 'fail', summary: 'Conflict too complex' } },
      planner,
    );

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

    await finalizeMergeFixerOnStreamEndForTests(group, task, planner);

    const updated = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.fixerAttempts, 1);
    assert.equal(updated.status, 'merging');
    const seed = buildMergeFixerSeedMessageForTests(updated, ['src/foo.ts'], {
      verifyFailureSummary: 'Conflict too complex',
      attemptNumber: 2,
      maxAttempts: 2,
    });
    assert.match(seed, /Conflict too complex/);
  });
});
