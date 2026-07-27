/**
 * Live board launch harness — real startTask / supervision / slot accounting with
 * scripted turns (MINNOW_TEST runner hook).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { isOrchestratePlanComplete } from '../../src/chat/orchestrate/plan-complete.ts';
import {
  clearTaskChatStallRestartsForTests,
  clearTaskQueuesForTests,
  countRunningTaskChats,
  isLaunchReservedForTests,
  releaseLaunchSlotForTests,
  resolveBoardMaxConcurrent,
} from '../../src/state/orchestrate-board-actions.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import {
  assertBoardConverged,
  assertTaskStatus,
  cleanMergeMocks,
  conflictMergeMocks,
  driveLiveBoard,
  fixerFailMocks,
  fixerResolveMocks,
  FLOW_FINAL_CHAT_ID,
  FLOW_GROUP_ID,
  getUnresolvedIssues,
  installFlowTestEnv,
  mockWorktreeOps,
  seedBoard,
  type BoardFlowScript,
} from './_board-flow-helpers.mts';
import { createScriptedTurnRunner, injectChatOutcome } from './_scripted-turn-runner.mts';

function assertLiveLaunchContract(
  group: { orchestrateBoard?: { tasks: { id: string }[] } | null },
  runner: ReturnType<typeof createScriptedTurnRunner>,
): void {
  const board = group.orchestrateBoard!;
  const taskIds = new Set(board.tasks.map((t) => t.id));

  const taskLaunches = runner.launches.filter(
    (l) => l.taskId && taskIds.has(l.taskId) && l.phase !== 'final',
  );
  assert.ok(taskLaunches.length > 0, 'expected at least one task build/test/fixer launch');

  for (const launch of taskLaunches) {
    assert.ok(
      runner.supervisionAtLaunch.includes(launch.chatId),
      `supervision must be active at launch for ${launch.chatId}`,
    );
    assert.ok(
      runner.slotsReservedAtLaunch.includes(launch.chatId),
      `launch slot must be reserved at turn start for ${launch.chatId}`,
    );
  }

  for (const launch of runner.launches) {
    assert.equal(
      isLaunchReservedForTests(launch.chatId),
      false,
      `launch slot must be released after turn for ${launch.chatId}`,
    );
  }

  assert.equal(countRunningTaskChats(board), 0, 'no leaked concurrency slots');
  assert.ok(
    runner.peakConcurrency <= resolveBoardMaxConcurrent(board),
    `peak concurrency ${runner.peakConcurrency} must respect cap ${resolveBoardMaxConcurrent(board)}`,
  );
}

describe('board live launch harness', () => {
  let restoreFetch: (() => void) | undefined;
  let envRestore: (() => void) | undefined;
  let runner: ReturnType<typeof createScriptedTurnRunner> | undefined;

  beforeEach(() => {
    const env = installFlowTestEnv();
    envRestore = env.restore;
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    clearTaskQueuesForTests();
    clearTaskChatStallRestartsForTests();
    resetAutopilotMetaCache();
    setAutopilotMetaForTests({ maxBuildAttempts: 2, maxConcurrentTasks: 3 });
  });

  afterEach(() => {
    runner?.restore();
    runner = undefined;
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

  test('happy path: multi-task board completes via driveLiveBoard', async () => {
    const script: BoardFlowScript = {
      tasks: {
        'W1-A': { build: 'complete', test: 'pass', merge: 'clean' },
        'W1-B': { build: 'complete', test: 'pass', merge: 'clean' },
        'W2-A': { build: 'complete', test: 'pass', merge: 'clean' },
      },
      finalTest: 'pass',
    };

    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }, { id: 'W2' }],
      tasks: [
        { id: 'W1-A', title: 'Wave one A', wave: 'W1' },
        { id: 'W1-B', title: 'Wave one B', wave: 'W1' },
        { id: 'W2-A', title: 'Wave two A', wave: 'W2' },
      ],
    });

    restoreFetch = mockWorktreeOps(cleanMergeMocks());
    runner = createScriptedTurnRunner({ script });

    await driveLiveBoard(group, planner, runner);

    assertTaskStatus(group, 'W1-A', 'complete');
    assertTaskStatus(group, 'W1-B', 'complete');
    assertTaskStatus(group, 'W2-A', 'complete');
    assert.ok(assertBoardConverged(group));
    assert.equal(group.orchestrateBoard?.finalTest?.status, 'passed');
    assert.ok(isOrchestratePlanComplete(group.orchestrateBoard!));
    assertLiveLaunchContract(group, runner);
  });

  test('conflict → fixer path', async () => {
    const script: BoardFlowScript = {
      tasks: {
        'W1-B': { build: 'complete', test: 'pass', merge: 'conflict', fixer: 'resolve' },
      },
    };

    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }],
      tasks: [{ id: 'W1-B', title: 'Conflict path', wave: 'W1' }],
    });

    restoreFetch = mockWorktreeOps({
      ...cleanMergeMocks(),
      ...conflictMergeMocks(),
      ...fixerResolveMocks(),
    });
    runner = createScriptedTurnRunner({ script });

    await driveLiveBoard(group, planner, runner);

    assertTaskStatus(group, 'W1-B', 'complete');
    assert.ok(assertBoardConverged(group));
    assert.ok(
      runner.launches.some((l) => l.phase === 'fix'),
      'fixer chat must be launched after merge conflict',
    );
    assertLiveLaunchContract(group, runner);
  });

  test('build-fail → self-heal → quarantine', async () => {
    const script: BoardFlowScript = {
      tasks: {
        'W1-C': { build: 'always-fail', test: 'pass', merge: 'clean' },
      },
    };

    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }],
      tasks: [{ id: 'W1-C', title: 'Quarantine path', wave: 'W1' }],
    });

    restoreFetch = mockWorktreeOps(cleanMergeMocks());
    runner = createScriptedTurnRunner({ script });

    await driveLiveBoard(group, planner, runner);

    assertTaskStatus(group, 'W1-C', 'quarantined');
    assert.ok(assertBoardConverged(group));
    const issues = getUnresolvedIssues(group);
    assert.ok(issues.some((u) => u.taskId === 'W1-C'));
    assert.ok(
      runner.launches.filter((l) => l.taskId === 'W1-C' && l.phase === 'build').length >= 2,
      'self-heal must retry build before quarantine',
    );
    assertLiveLaunchContract(group, runner);
  });

  test('sequential mode', async () => {
    const script: BoardFlowScript = {
      tasks: {
        'W1-A': { build: 'complete', test: 'pass', merge: 'clean' },
        'W1-B': { build: 'complete', test: 'pass', merge: 'clean' },
      },
    };

    const { planner, group } = seedBoard(
      {
        waves: [{ id: 'W1' }],
        maxConcurrentTasks: 3,
        tasks: [
          { id: 'W1-A', title: 'Sequential A', wave: 'W1' },
          { id: 'W1-B', title: 'Sequential B', wave: 'W1' },
        ],
      },
      'sequential',
    );

    restoreFetch = mockWorktreeOps(cleanMergeMocks());
    runner = createScriptedTurnRunner({ script });

    await driveLiveBoard(group, planner, runner);

    assertTaskStatus(group, 'W1-A', 'complete');
    assertTaskStatus(group, 'W1-B', 'complete');
    assert.equal(resolveBoardMaxConcurrent(group.orchestrateBoard!), 1);
    assert.equal(runner.peakConcurrency, 1, 'sequential mode must never exceed one slot');
    assertLiveLaunchContract(group, runner);
  });

  test('multi-task: builder prose-only on W1-A nudges while W1-B completes', async () => {
    const script: BoardFlowScript = {
      tasks: {
        'W1-A': { build: 'complete', test: 'pass', merge: 'clean' },
        'W1-B': { build: 'complete', test: 'pass', merge: 'clean' },
      },
    };

    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }],
      tasks: [
        { id: 'W1-A', title: 'Prose-only path', wave: 'W1' },
        { id: 'W1-B', title: 'Happy sibling', wave: 'W1' },
      ],
    });

    restoreFetch = mockWorktreeOps(cleanMergeMocks());
    const proseOnlyAttempts = new Map<string, number>();
    runner = createScriptedTurnRunner({
      script,
      override: (ctx) => {
        if (ctx.phase === 'build' && ctx.task?.id === 'W1-A') {
          const n = proseOnlyAttempts.get('W1-A') ?? 0;
          proseOnlyAttempts.set('W1-A', n + 1);
          if (n < 2) {
            ctx.chat.history.push({
              role: 'assistant',
              content: 'Status: READY FOR VERIFICATION',
            });
            return;
          }
          if (ctx.task) {
            ctx.task.boardReport = { outcome: 'pass', summary: 'Recovered after nudges' };
          }
          ctx.chat.history.push({ role: 'assistant', content: 'Build complete for W1-A.' });
          return;
        }
        if (ctx.phase === 'build') {
          injectChatOutcome(ctx.chat, ctx.task, 'build', { build: 'complete' });
          return;
        }
        if (ctx.phase === 'test') {
          injectChatOutcome(ctx.chat, ctx.task, 'test', {
            test: script.tasks[ctx.task?.id ?? '']?.test ?? 'pass',
          });
        }
      },
    });

    await driveLiveBoard(group, planner, runner);

    assertTaskStatus(group, 'W1-A', 'complete');
    assertTaskStatus(group, 'W1-B', 'complete');
    assert.ok(proseOnlyAttempts.get('W1-A')! >= 3, 'W1-A should need nudged build retries');
    assertLiveLaunchContract(group, runner);
  });

  test('multi-task: missing-report nudge on W1-A does not block W1-B drain', async () => {
    const script: BoardFlowScript = {
      tasks: {
        'W1-A': { build: 'complete', test: 'pass', merge: 'clean' },
        'W1-B': { build: 'complete', test: 'pass', merge: 'clean' },
      },
    };

    const { planner, group } = seedBoard({
      waves: [{ id: 'W1' }],
      maxConcurrentTasks: 2,
      tasks: [
        { id: 'W1-A', title: 'Slow nudge path', wave: 'W1' },
        { id: 'W1-B', title: 'Parallel happy', wave: 'W1' },
      ],
    });

    restoreFetch = mockWorktreeOps(cleanMergeMocks());
    const buildAttempts = new Map<string, number>();
    runner = createScriptedTurnRunner({
      script,
      override: (ctx) => {
        if (ctx.phase === 'build' && ctx.task?.id === 'W1-A') {
          const n = buildAttempts.get('W1-A') ?? 0;
          buildAttempts.set('W1-A', n + 1);
          if (n < 2) {
            ctx.chat.history.push({
              role: 'assistant',
              content: 'Done but forgot board_report.',
            });
            return;
          }
          ctx.task!.boardReport = { outcome: 'pass', summary: 'Recovered after nudges' };
          ctx.chat.history.push({ role: 'assistant', content: 'Build W1-A recovered.' });
          return;
        }
        if (ctx.phase === 'build') {
          ctx.task!.boardReport = { outcome: 'pass', summary: `ok ${ctx.task?.id}` };
          ctx.chat.history.push({ role: 'assistant', content: `Build ${ctx.task?.id}` });
          return;
        }
        if (ctx.phase === 'test') {
          ctx.task!.testVerdict = 'pass';
          ctx.chat.history.push({ role: 'assistant', content: 'VERDICT: pass' });
        }
      },
    });

    await driveLiveBoard(group, planner, runner);

    assertTaskStatus(group, 'W1-B', 'complete');
    const taskA = group.orchestrateBoard?.tasks.find((t) => t.id === 'W1-A');
    assert.ok(
      taskA?.status === 'in_progress' || taskA?.status === 'complete' || taskA?.status === 'testing',
      'W1-A should still be recovering or complete, not block sibling',
    );
    assertLiveLaunchContract(group, runner);
  });
});
