/**
 * Env-fixer stall/stop recovery — the stream-end finalizer is the single owner
 * of stalled-fixer recovery (double-dispatch race fix).
 *
 *  - heartbeat stall on a fixer chat: stop only (no nudge, no direct self-heal)
 *  - stall-stop stream end (system stop, board running): exactly one bounded
 *    env-fix attempt is burned; no quarantine; exactly one new fixer dispatch
 *  - orphan fixer stream-end (task already points at a newer fixer): no-op
 *  - user stop: neutral — linkage cleared, no attempt burn, stays in_progress
 *  - pass while paused: pass is recorded (column + linkage) without launching
 *  - launch failure: routed into self-heal instead of dead-ending the board
 *
 * Patterns from fixer-recovery.test.mts; MINNOW_TEST=1 skips real chat launches.
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  bumpProgress,
  chatTaskRunId,
  resetWrapperState,
  tickHeartbeatForTests,
} from '../../src/agents/controller/wrapper.ts';
import { resetAutopilotMetaCache, setAutopilotMetaForTests } from '../../src/config/autopilot-meta.ts';
import {
  clearStallStoppedChatIdsForTests,
  clearTaskChatStallRestartsForTests,
  finalizeEnvFixerOnStreamEndForTests,
  getTaskChatStallRestartCountForTests,
  handleTaskChatLaunchFailureForTests,
  isStallStoppedChatForTests,
  releaseLaunchSlotForTests,
  simulateUnmatchedFixerStreamEndForTests,
  startTaskChatSupervisionForTests,
  trackFixerStallStopsForTests,
  trackTaskChatStallRecoveryCallsForTests,
  triggerFixerStallReconcileForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { sessionState, setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = 'aaaa-aaaa-planner';
const BUILDER_CHAT_ID = 'bbbb-bbbb-builder';
const FIXER_CHAT_ID = 'cccc-cccc-fixer';
const NEW_FIXER_CHAT_ID = 'dddd-dddd-new-fixer';
const GROUP_ID = 'grp_aaaa-aaaa';
const TASK_ID = 'W1-A';
const PROGRESS_STALL_MS = 10_000;
const STALL_THRESHOLD_MS = PROGRESS_STALL_MS * 3;

let now = 0;
let originalNow: typeof performance.now;
let domWindow: Window | undefined;
const prevMinnowTest = process.env.MINNOW_TEST;

function setupDom(): void {
  domWindow = new Window();
  globalThis.document = domWindow.document;
  globalThis.window = domWindow as unknown as Window & typeof globalThis.window;
}

function teardownDom(): void {
  domWindow?.close();
  domWindow = undefined;
  // @ts-expect-error test cleanup
  delete globalThis.document;
  // @ts-expect-error test cleanup
  delete globalThis.window;
}

function makePlanner(): Chat {
  return {
    id: PLANNER_ID,
    name: 'Planner',
    workspacePath: '/ws',
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

function makeBuilderChat(): Chat {
  return {
    id: BUILDER_CHAT_ID,
    name: 'Task W1-A',
    workspacePath: '/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: TASK_ID,
  };
}

function makeEnvFixerChat(options?: {
  id?: string;
  stopReason?: 'user' | 'system';
}): Chat {
  const chat: Chat = {
    id: options?.id ?? FIXER_CHAT_ID,
    name: 'Fix env W1-A',
    workspacePath: '/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [{ role: 'user', content: 'Fix missing deps' }],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: TASK_ID,
  };
  if (options?.stopReason) {
    chat.runs = [
      {
        runId: 'run_stop_1',
        branchId: 'b1',
        forkHistoryIndex: 0,
        status: 'stopped',
        stopReason: options.stopReason,
        createdAt: 10,
        snapshot: null as never,
      },
    ];
  }
  return chat;
}

function makeGroup(shape: 'stopped' | 'sequential' | 'auto' | 'afk' = 'afk'): ChatGroup {
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Board',
    workspacePath: '/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PLANNER_ID,
    orchestratePlanPath: 'documentation/plans/test.md',
    viewMode: 'board',
  };
  const planner = makePlanner();
  initBoard(group, planner, {
    planPath: 'documentation/plans/test.md',
    tasks: [
      {
        id: TASK_ID,
        title: 'Task A',
        wave: 'W1',
        category: 'build',
        build: 'Build feature',
        test: 'Run tests',
      },
    ],
    waves: [{ id: 'W1', status: 'in_progress' }],
  });
  group.orchestrateBoard!.maxConcurrentTasks = shape === 'auto' ? 3 : 1;
  if (shape === 'afk') group.orchestrateBoard!.handsOff = true;
  if (shape === 'stopped') group.orchestrateBoard!.autoRunning = false;
  group.orchestrateBoard!.autoRunning = true;
  return group;
}

function seedEnvFixerTask(
  group: ChatGroup,
  fixerChat: Chat,
  taskOverrides: Record<string, unknown> = {},
): { planner: Chat } {
  const planner = makePlanner();
  updateTask(
    group,
    TASK_ID,
    {
      status: 'in_progress',
      chatId: BUILDER_CHAT_ID,
      fixerChatId: fixerChat.id,
      fixerKind: 'env',
      envFixPhase: 'build',
      worktreePath: '/ws',
      ...taskOverrides,
    },
    planner,
  );
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner, makeBuilderChat(), fixerChat],
    groups: [group],
  });
  return { planner };
}

function getTask(group: ChatGroup) {
  return group.orchestrateBoard!.tasks.find((t) => t.id === TASK_ID)!;
}

beforeEach(() => {
  process.env.MINNOW_TEST = '1';
  setupDom();
  now = 0;
  originalNow = performance.now;
  performance.now = () => now;

  resetWrapperState();
  clearTaskChatStallRestartsForTests();
  clearStallStoppedChatIdsForTests();
  trackTaskChatStallRecoveryCallsForTests(false);
  trackFixerStallStopsForTests(false);
  setSessionStateForTests(null);

  setAutopilotMetaForTests({
    progressStallMs: PROGRESS_STALL_MS,
    heartbeatIntervalMs: 100,
    heartbeatDeadMs: 10_000,
    selfHealMaxRounds: 2,
    maxEnvFixAttempts: 2,
  });
});

afterEach(() => {
  performance.now = originalNow;
  resetWrapperState();
  resetAutopilotMetaCache();
  clearTaskChatStallRestartsForTests();
  clearStallStoppedChatIdsForTests();
  trackTaskChatStallRecoveryCallsForTests(false);
  trackFixerStallStopsForTests(false);
  releaseLaunchSlotForTests(FIXER_CHAT_ID);
  releaseLaunchSlotForTests(NEW_FIXER_CHAT_ID);
  teardownDom();
  setSessionStateForTests(null);
  if (prevMinnowTest === undefined) {
    delete process.env.MINNOW_TEST;
  } else {
    process.env.MINNOW_TEST = prevMinnowTest;
  }
});

describe('env-fixer stall: heartbeat stops only', () => {
  test('stall records a fixer stall-stop — no nudge, no direct self-heal', () => {
    const group = makeGroup();
    seedEnvFixerTask(group, makeEnvFixerChat());

    trackTaskChatStallRecoveryCallsForTests(true);
    const stallStops = trackFixerStallStopsForTests(true);
    startTaskChatSupervisionForTests(FIXER_CHAT_ID);

    const runId = chatTaskRunId(FIXER_CHAT_ID);
    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);

    const { nudges, selfHeals } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(stallStops, [{ taskId: TASK_ID, chatId: FIXER_CHAT_ID }]);
    assert.equal(nudges.length, 0, 'fixer stall must not nudge');
    assert.equal(selfHeals.length, 0, 'fixer stall must not self-heal directly');
    assert.equal(getTaskChatStallRestartCountForTests(FIXER_CHAT_ID), 0);
    assert.equal(isStallStoppedChatForTests(FIXER_CHAT_ID), true);
    const task = getTask(group);
    assert.equal(task.status, 'in_progress', 'stall-stop must not finalize');
    assert.equal(task.fixerChatId, FIXER_CHAT_ID, 'linkage untouched until stream end');
  });
});

describe('env-fixer stream-end finalizer routing', () => {
  test('stall-stop stream end burns exactly one attempt and dispatches once', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(
      group,
      makeEnvFixerChat({ stopReason: 'system' }),
    );
    const chatCountBefore = sessionState!.chats.length;

    await triggerFixerStallReconcileForTests(group, planner, TASK_ID);

    const task = getTask(group);
    assert.equal(task.envFixAttempts, 1, 'exactly one env-fix attempt burned');
    assert.equal(task.quarantine, undefined, 'no quarantine while attempts remain');
    assert.equal(task.status, 'in_progress');
    assert.ok(task.fixerChatId, 'self-heal must dispatch a replacement fixer');
    assert.notEqual(task.fixerChatId, FIXER_CHAT_ID, 'replacement must be a fresh chat');
    assert.equal(task.fixerKind, 'env');
    assert.equal(
      sessionState!.chats.length,
      chatCountBefore + 1,
      'exactly one new fixer chat dispatched',
    );
  });

  test('orphan fixer stream-end leaves the live fixer state untouched', async () => {
    const group = makeGroup();
    const oldFixerChat = makeEnvFixerChat({ id: FIXER_CHAT_ID, stopReason: 'system' });
    const newFixerChat = makeEnvFixerChat({ id: NEW_FIXER_CHAT_ID });
    const planner = makePlanner();
    updateTask(
      group,
      TASK_ID,
      {
        status: 'in_progress',
        chatId: BUILDER_CHAT_ID,
        fixerChatId: NEW_FIXER_CHAT_ID,
        fixerKind: 'env',
        envFixPhase: 'build',
        envFixAttempts: 1,
        worktreePath: '/ws',
      },
      planner,
    );
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, makeBuilderChat(), oldFixerChat, newFixerChat],
      groups: [group],
    });
    const chatCountBefore = sessionState!.chats.length;

    // The OLD superseded fixer chat ends while the task points at the NEW one.
    await simulateUnmatchedFixerStreamEndForTests(group, planner, FIXER_CHAT_ID);

    const task = getTask(group);
    assert.equal(task.fixerChatId, NEW_FIXER_CHAT_ID, 'live fixer linkage untouched');
    assert.equal(task.fixerKind, 'env');
    assert.equal(task.envFixPhase, 'build');
    assert.equal(task.envFixAttempts, 1, 'orphan end must not burn an attempt');
    assert.equal(task.status, 'in_progress');
    assert.equal(task.quarantine, undefined);
    assert.equal(sessionState!.chats.length, chatCountBefore, 'no new fixer dispatched');
  });

  test('user stop is neutral: linkage cleared, no attempt burn, stays in_progress', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(
      group,
      makeEnvFixerChat({ stopReason: 'user' }),
    );
    const chatCountBefore = sessionState!.chats.length;

    await triggerFixerStallReconcileForTests(group, planner, TASK_ID);

    const task = getTask(group);
    assert.equal(task.fixerChatId, undefined, 'linkage cleared');
    assert.equal(task.fixerKind, undefined);
    assert.equal(task.envFixPhase, undefined);
    assert.equal(task.envFixAttempts ?? 0, 0, 'user stop must not burn an attempt');
    assert.equal(task.status, 'in_progress');
    assert.equal(task.quarantine, undefined);
    assert.equal(sessionState!.chats.length, chatCountBefore, 'no replacement fixer');
  });

  test('stop while board paused is neutral even with a system stop reason', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(
      group,
      makeEnvFixerChat({ stopReason: 'system' }),
    );
    group.orchestrateBoard!.autoRunning = false;

    await triggerFixerStallReconcileForTests(group, planner, TASK_ID);

    const task = getTask(group);
    assert.equal(task.fixerChatId, undefined, 'linkage cleared');
    assert.equal(task.envFixAttempts ?? 0, 0, 'paused stop must not burn an attempt');
    assert.equal(task.status, 'in_progress');
  });

  test('test-phase pass while paused records testing + clears linkage, no launch', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(group, makeEnvFixerChat(), {
      envFixPhase: 'test',
      boardReport: { outcome: 'pass', summary: 'Services up' },
    });
    group.orchestrateBoard!.autoRunning = false;

    await finalizeEnvFixerOnStreamEndForTests(group, getTask(group), planner, FIXER_CHAT_ID);

    const task = getTask(group);
    assert.equal(task.status, 'testing', 'pass must advance the column while paused');
    assert.equal(task.fixerChatId, undefined, 'linkage cleared while paused');
    assert.equal(task.fixerKind, undefined);
    assert.equal(task.envFixPhase, undefined);
    assert.equal(task.testChatId, undefined, 'no tester chat launched while paused');
  });

  test('build-phase pass while paused clears linkage and stays in_progress', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(group, makeEnvFixerChat(), {
      envFixPhase: 'build',
      boardReport: { outcome: 'pass', summary: 'Deps installed' },
    });
    group.orchestrateBoard!.autoRunning = false;

    await finalizeEnvFixerOnStreamEndForTests(group, getTask(group), planner, FIXER_CHAT_ID);

    const task = getTask(group);
    assert.equal(task.status, 'in_progress');
    assert.equal(task.fixerChatId, undefined, 'linkage cleared while paused');
    assert.equal(task.fixerKind, undefined);
    assert.equal(task.envFixPhase, undefined);
  });
});

describe('task-chat launch failure recovery', () => {
  test('env-fixer launch failure clears linkage and drives bounded self-heal', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(group, makeEnvFixerChat());

    handleTaskChatLaunchFailureForTests(
      group,
      planner,
      TASK_ID,
      'build',
      'env-fixer',
      'provider exploded',
    );

    // Synchronous effects: error recorded, stale linkage cleared.
    let task = getTask(group);
    assert.equal(task.error, 'provider exploded');
    assert.equal(task.fixerChatId, undefined, 'failed launch must not leave stale linkage');

    // Deferred self-heal (runs after the launch slot would be released).
    await new Promise((resolve) => setTimeout(resolve, 50));
    task = getTask(group);
    assert.equal(task.envFixAttempts, 1, 'self-heal must drive a bounded env-fix attempt');
    assert.ok(task.fixerChatId, 'replacement fixer dispatched');
    assert.notEqual(task.fixerChatId, FIXER_CHAT_ID);
  });

  test('build launch failure with self-heal exhausted quarantines, never a silent board', async () => {
    // AFK immediately requeues root quarantines (onTasksQuarantined); auto keeps terminal quarantine.
    const group = makeGroup('auto');
    const { planner } = seedEnvFixerTask(group, makeEnvFixerChat(), {
      fixerChatId: undefined,
      fixerKind: undefined,
      envFixPhase: undefined,
      selfHealRound: 2, // selfHealMaxRounds = 2 → ceiling reached
    });

    handleTaskChatLaunchFailureForTests(
      group,
      planner,
      TASK_ID,
      'build',
      'build',
      'launch failed',
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    const task = getTask(group);
    assert.equal(task.status, 'quarantined', 'exhausted retries must quarantine');
    assert.equal(task.error, 'launch failed', 'launch error stays recorded');
    assert.ok(task.quarantine, 'quarantine issue must be attached');
  });

  test('launch failure on a stopped board records the error only', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(group, makeEnvFixerChat());
    group.orchestrateBoard!.autoRunning = false;

    handleTaskChatLaunchFailureForTests(
      group,
      planner,
      TASK_ID,
      'build',
      'env-fixer',
      'provider exploded',
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    const task = getTask(group);
    assert.equal(task.error, 'provider exploded');
    assert.equal(task.fixerChatId, undefined, 'linkage still cleared');
    assert.equal(task.envFixAttempts ?? 0, 0, 'no heal work on a stopped board');
    assert.equal(task.quarantine, undefined);
  });
});
