/**
 * Orchestrate board lifecycle E2E — multi-transition flow via driveBoardToConvergence.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { isOrchestratePlanComplete } from '../../src/chat/orchestrate/plan-complete.ts';
import { bootOrchestrateBoardResume } from '../../src/chat/orchestrate/board-boot-resume.ts';
import {
  clearTaskChatStallRestartsForTests,
  clearTaskQueuesForTests,
  countRunningTaskChats,
  listRunningBoardTaskSlots,
  releaseLaunchSlotForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { sessionState, setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import { updateTask } from '../../src/state/orchestrate-board-store.ts';
import type { Chat } from '../../src/types.ts';
import {
  assertBoardConverged,
  assertTaskStatus,
  bootstrapPendingLaunches,
  cleanMergeMocks,
  driveBoardToConvergence,
  FLOW_FINAL_CHAT_ID,
  FLOW_GROUP_ID,
  FLOW_INTEGRATION_BRANCH,
  FLOW_PLANNER_ID,
  getUnresolvedIssues,
  installFlowTestEnv,
  mockWorktreeOps,
  seedBoard,
  taskChatId,
} from './_board-flow-helpers.mts';

describe('board flow E2E harness', () => {
  let restoreFetch: (() => void) | undefined;
  let envRestore: (() => void) | undefined;

  beforeEach(() => {
    const env = installFlowTestEnv();
    envRestore = env.restore;
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    clearTaskQueuesForTests();
    clearTaskChatStallRestartsForTests();
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 2, maxConcurrentTasks: 3 });
    restoreFetch = mockWorktreeOps(cleanMergeMocks());
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    envRestore?.();
    envRestore = undefined;
    setLocalServerAvailableForTests(false);
    clearTaskQueuesForTests();
    clearTaskChatStallRestartsForTests();
    releaseLaunchSlotForTests(FLOW_FINAL_CHAT_ID);
    setSessionStateForTests(null);
    resetAutopilotMetaCache();
  });

  test('happy path: three tasks across two waves → final test pass → plan complete', async () => {
    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }, { id: 'W2' }],
      tasks: [
        { id: 'W1-A', title: 'Wave one A', wave: 'W1' },
        { id: 'W1-B', title: 'Wave one B', wave: 'W1' },
        { id: 'W2-A', title: 'Wave two A', wave: 'W2' },
      ],
    });

    await driveBoardToConvergence(
      group,
      planner,
      {
        tasks: {
          'W1-A': { build: 'complete', test: 'pass', merge: 'clean' },
          'W1-B': { build: 'complete', test: 'pass', merge: 'clean' },
          'W2-A': { build: 'complete', test: 'pass', merge: 'clean' },
        },
        finalTest: 'pass',
      },
      {
        maxIterations: 80,
        setWorktreeMocks: (mocks) => {
          restoreFetch?.();
          restoreFetch = mockWorktreeOps(mocks);
        },
      },
    );

    assertTaskStatus(group, 'W1-A', 'complete');
    assertTaskStatus(group, 'W1-B', 'complete');
    assertTaskStatus(group, 'W2-A', 'complete');
    assert.ok(assertBoardConverged(group));
    assert.equal(group.orchestrateBoard?.finalTest?.status, 'passed');
    assert.ok(group.orchestrateBoard?.completionShownAt, 'plan-complete should fire after final test');
    assert.ok(isOrchestratePlanComplete(group.orchestrateBoard!));
  });

  test('wave barrier: W2 slots never appear until W1 is terminal', async () => {
    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }, { id: 'W2' }],
      tasks: [
        { id: 'W1-A', title: 'Wave one A', wave: 'W1' },
        { id: 'W1-B', title: 'Wave one B', wave: 'W1' },
        { id: 'W2-A', title: 'Wave two A', wave: 'W2' },
      ],
    });

    const w2SlotTaskIds: string[] = [];
    let w1Terminal = false;

    await driveBoardToConvergence(
      group,
      planner,
      {
        tasks: {
          'W1-A': { build: 'complete', test: 'pass', merge: 'clean' },
          'W1-B': { build: 'complete', test: 'pass', merge: 'clean' },
          'W2-A': { build: 'complete', test: 'pass', merge: 'clean' },
        },
        finalTest: 'pass',
      },
      {
        maxIterations: 80,
        onIteration({ slots }) {
          const board = group.orchestrateBoard!;
          w1Terminal = board.tasks
            .filter((t) => t.wave === 'W1')
            .every((t) => t.status === 'complete' || t.status === 'quarantined');
          for (const slot of slots) {
            if (slot.taskId === 'W2-A' && !w1Terminal) {
              w2SlotTaskIds.push(slot.taskId);
            }
          }
        },
      },
    );

    assert.deepEqual(w2SlotTaskIds, [], 'W2 must not launch before W1 terminal');
    assertTaskStatus(group, 'W2-A', 'complete');
  });

  test('mixed convergence: self-heal, fixer merge, and quarantine', async () => {
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 2, maxConcurrentTasks: 3 });

    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'W1-A', title: 'Heal path', wave: 'W1' },
        { id: 'W1-B', title: 'Conflict path', wave: 'W1' },
        { id: 'W1-C', title: 'Quarantine path', wave: 'W1' },
      ],
    });

    await driveBoardToConvergence(
      group,
      planner,
      {
        tasks: {
          'W1-A': { build: 'fail-then-heal', test: 'pass', merge: 'clean' },
          'W1-B': { build: 'complete', test: 'pass', merge: 'conflict', fixer: 'resolve' },
          'W1-C': { build: 'always-fail', test: 'pass', merge: 'clean' },
        },
      },
      {
        maxIterations: 100,
        setWorktreeMocks: (mocks) => {
          restoreFetch?.();
          restoreFetch = mockWorktreeOps(mocks);
        },
      },
    );

    assertTaskStatus(group, 'W1-A', 'complete');
    assertTaskStatus(group, 'W1-B', 'complete');
    assertTaskStatus(group, 'W1-C', 'quarantined');
    assert.ok(assertBoardConverged(group));

    const issues = getUnresolvedIssues(group);
    assert.ok(issues.some((u) => u.taskId === 'W1-C'));
  });

  test('fixer-deadlock regression: stale fixer does not block sibling merge in flow', async () => {
    const staleFixerId = taskChatId('W1-B', 'fixer');
    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'W1-B', title: 'Stale fixer task', wave: 'W1' },
        { id: 'W1-C', title: 'Sibling merge', wave: 'W1' },
      ],
    });

    const staleFixerChat: Chat = {
      id: staleFixerId,
      name: 'Stale fixer',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      history: [{ role: 'assistant', content: 'Stalled mid-merge' }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: FLOW_GROUP_ID,
      boardTaskId: 'W1-B',
    };

    updateTask(
      group,
      'W1-B',
      {
        status: 'merging',
        fixerChatId: staleFixerId,
        worktreeBranch: 'minnow/board/W1-B',
        mergePreSha: 'deadbeef',
      },
      planner,
    );
    updateTask(
      group,
      'W1-C',
      {
        status: 'testing',
        worktreeBranch: 'minnow/board/W1-C',
        testVerdict: 'pass',
        testSummary: 'ok',
        testChatId: taskChatId('W1-C', 'test'),
      },
      planner,
    );

    if (!sessionState) throw new Error('session not initialized');
    sessionState.chats = [planner, staleFixerChat];

    await driveBoardToConvergence(
      group,
      planner,
      {
        tasks: {
          'W1-C': { build: 'complete', test: 'pass', merge: 'clean' },
        },
      },
      {
        maxIterations: 30,
        setWorktreeMocks: (mocks) => {
          restoreFetch?.();
          restoreFetch = mockWorktreeOps(mocks);
        },
      },
    );

    assertTaskStatus(group, 'W1-C', 'complete');
    assert.notEqual(group.orchestrateBoard?.tasks.find((t) => t.id === 'W1-B')?.status, 'merging');
  });

  test('reload mid-flight: boot resume does not double-launch active slots', async () => {
    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }],
      maxConcurrentTasks: 2,
      tasks: [
        { id: 'W1-A', title: 'In progress', wave: 'W1' },
        { id: 'W1-B', title: 'Testing', wave: 'W1' },
      ],
    });

    updateTask(
      group,
      'W1-A',
      { status: 'in_progress', chatId: taskChatId('W1-A', 'build'), startedAt: 1 },
      planner,
    );
    updateTask(
      group,
      'W1-B',
      {
        status: 'testing',
        chatId: taskChatId('W1-B', 'build'),
        testChatId: taskChatId('W1-B', 'test'),
        startedAt: 1,
      },
      planner,
    );

    await bootstrapPendingLaunches(group, planner);
    const slotsBefore = countRunningTaskChats(group.orchestrateBoard!);
    assert.ok(slotsBefore > 0);

    const snapshot = {
      version: 5 as const,
      activeId: FLOW_PLANNER_ID,
      chats: sessionState?.chats ?? [],
      groups: [structuredClone(group)],
    };

    group.orchestrateBoard!.integrationBranch = FLOW_INTEGRATION_BRANCH;
    await bootOrchestrateBoardResume(snapshot);

    const resumedGroup = snapshot.groups[0]!;
    const slotsAfter = countRunningTaskChats(resumedGroup.orchestrateBoard!);
    assert.equal(
      slotsAfter,
      slotsBefore,
      'reload resume must not spawn duplicate concurrency slots',
    );

    const slotIds = listRunningBoardTaskSlots(resumedGroup.orchestrateBoard!).map((s) => s.chatId);
    assert.equal(new Set(slotIds).size, slotIds.length, 'slot chat ids must be unique');
  });
});

