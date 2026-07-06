/**
 * Fixer recovery regression tests (documentation/plans/fixer-recovery-merged-plan.md).
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
  resetOrchestratorAutoReportsForTests,
  setOrchestratorReportDeliverHook,
} from '../../src/agents/controller/report.ts';
import {
  autoDelegateNext,
  clearStallStoppedChatIdsForTests,
  clearTaskChatStallRestartsForTests,
  continueBoardTask,
  isStallStoppedChatForTests,
  enqueueMergeCompletedTaskWorktreeForTests,
  finalizeBoardTaskOnStreamEnd,
  getTaskChatStallRestartCountForTests,
  finalizeMergeFixerOnStreamEndForTests,
  recoverMergingBoardTask,
  reconcileMergingTasks,
  releaseLaunchSlotForTests,
  reserveLaunchSlotForTests,
  restartBoardTask,
  setMaxFixerWaitMsForTests,
  startBoardAutoRun,
  startTaskChatSupervisionForTests,
  stopBoardAutoRun,
  trackFixerStallStopsForTests,
  trackReconcileMergingTasksCallsForTests,
  trackTaskChatStallRecoveryCallsForTests,
  triggerFixerStallReconcileForTests,
  trackDrainResumeCallsForTests,
  enqueueTaskForTests,
  getTaskQueueForTests,
  countRunningTaskChats,
  isLaunchReservedForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, isTaskStalledForRestart, updateTask } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = 'aaaa-aaaa-planner';
const BUILDER_CHAT_ID = 'bbbb-bbbb-builder';
const FIXER_CHAT_ID = 'cccc-cccc-fixer';
const GROUP_ID = 'grp_aaaa-aaaa';
const TASK_ID = 'W1-A';
const PROGRESS_STALL_MS = 10_000;
/** All supervised task chats use 3× progressStallMs before stall recovery. */
const STALL_THRESHOLD_MS = PROGRESS_STALL_MS * 3;

// Fix A fixtures (merge-fixer heartbeat reconcile)
const FIX_A_PLANNER_ID = '22222222-2222-2222-2222-222222222222';
const FIX_A_GROUP_ID = 'grp_22222222-2222-2222-2222-222222222222';
const MERGE_FIXER_CHAT_ID = '66666666-6666-6666-6666-666666666666';
const MERGE_TASK_ID = 'W1-B';
const TASK_BRANCH = 'minnow/board/W1-B';
const INTEGRATION_BRANCH = 'minnow/integration/grp_22222222';

let now = 0;
let originalNow: typeof performance.now;
let domWindow: Window | undefined;

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

async function waitForAsyncReconcile(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function makeFixAPlanner(): Chat {
  return {
    id: FIX_A_PLANNER_ID,
    name: 'Planner',
    workspacePath: '/tmp/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    orchestratePlanPath: 'documentation/plans/test.md',
    boardGroupId: FIX_A_GROUP_ID,
  };
}

function makeMergeFixerChat(): Chat {
  return {
    id: MERGE_FIXER_CHAT_ID,
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
    boardGroupId: FIX_A_GROUP_ID,
    boardTaskId: MERGE_TASK_ID,
    currentGenerationId: 'gen-still-running',
  };
}

function makeMergeGroup(): ChatGroup {
  const group: ChatGroup = {
    id: FIX_A_GROUP_ID,
    name: 'Board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    plannerChatId: FIX_A_PLANNER_ID,
    orchestratePlanPath: 'documentation/plans/test.md',
    viewMode: 'board',
  };
  const planner = makeFixAPlanner();
  initBoard(group, planner, {
    planPath: 'documentation/plans/test.md',
    tasks: [
      {
        id: MERGE_TASK_ID,
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
  group.orchestrateBoard!.executionMode = 'afk';
  group.orchestrateBoard!.autoRunning = true;
  return group;
}

function seedMergingTask(
  group: ChatGroup,
  fixerChat: Chat,
): { group: ChatGroup; planner: Chat; fixerChat: Chat } {
  const planner = makeFixAPlanner();
  updateTask(
    group,
    MERGE_TASK_ID,
    {
      status: 'merging',
      fixerChatId: MERGE_FIXER_CHAT_ID,
      worktreeBranch: TASK_BRANCH,
      mergePreSha: 'deadbeef',
    },
    planner,
  );
  setSessionStateForTests({
    chats: [planner, fixerChat],
    groups: [group],
    activeChatId: FIX_A_PLANNER_ID,
  });
  return { group, planner, fixerChat };
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
    boardGroupId: GROUP_ID,
  };
}

function makeBuilderChat(): Chat {
  return {
    id: BUILDER_CHAT_ID,
    name: 'Build W1-A',
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

function makeEnvFixerChat(): Chat {
  return {
    id: FIXER_CHAT_ID,
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
}

function makeGroup(): ChatGroup {
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
  group.orchestrateBoard!.executionMode = 'afk';
  group.orchestrateBoard!.autoRunning = true;
  return group;
}

function seedEnvFixerTask(group: ChatGroup): { planner: Chat; fixerChat: Chat } {
  const planner = makePlanner();
  const fixerChat = makeEnvFixerChat();
  updateTask(
    group,
    TASK_ID,
    {
      status: 'in_progress',
      chatId: BUILDER_CHAT_ID,
      fixerChatId: FIXER_CHAT_ID,
      fixerKind: 'env',
      envFixPhase: 'build',
      worktreePath: '/ws',
    },
    planner,
  );
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner, makeBuilderChat(), fixerChat],
    groups: [group],
  });
  return { planner, fixerChat };
}

beforeEach(() => {
  now = 0;
  originalNow = performance.now;
  performance.now = () => now;

  resetWrapperState();
  clearTaskChatStallRestartsForTests();
  clearStallStoppedChatIdsForTests();
  trackTaskChatStallRecoveryCallsForTests(false);
  trackFixerStallStopsForTests(false);

  setAutopilotMetaForTests({
    progressStallMs: PROGRESS_STALL_MS,
    heartbeatIntervalMs: 100,
    heartbeatDeadMs: 10_000,
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
});

describe('Fix A — merge-fixer unified stall recovery', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setupDom();
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    clearTaskChatStallRestartsForTests();
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    teardownDom();
    setLocalServerAvailableForTests(false);
    clearTaskChatStallRestartsForTests();
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('heartbeat tick does not git-poll or change task status', async () => {
    const group = makeMergeGroup();
    const fixerChat = makeMergeFixerChat();
    seedMergingTask(group, fixerChat);

    let fetchCalls = 0;
    const saved = globalThis.fetch;
    // @ts-ignore — test-only replacement
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ ok: false, error: 'unexpected' }) };
    };
    restoreFetch = () => {
      globalThis.fetch = saved;
    };

    startTaskChatSupervisionForTests(MERGE_FIXER_CHAT_ID);
    const runId = chatTaskRunId(MERGE_FIXER_CHAT_ID);
    bumpProgress(runId);
    tickHeartbeatForTests(runId);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === MERGE_TASK_ID)!;
    assert.equal(task.status, 'merging', 'heartbeat must not advance status');
    assert.equal(fetchCalls, 0, 'heartbeat must not call /api/worktree');
  });

  test('fixer stall at 3x stops the turn only — no nudge, no direct self-heal', async () => {
    const group = makeMergeGroup();
    const fixerChat = makeMergeFixerChat();
    seedMergingTask(group, fixerChat);

    trackTaskChatStallRecoveryCallsForTests(true);
    const stallStops = trackFixerStallStopsForTests(true);
    startTaskChatSupervisionForTests(MERGE_FIXER_CHAT_ID);
    const runId = chatTaskRunId(MERGE_FIXER_CHAT_ID);
    bumpProgress(runId);

    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);

    const { nudges, selfHeals } = trackTaskChatStallRecoveryCallsForTests(false);
    const task = group.orchestrateBoard!.tasks.find((t) => t.id === MERGE_TASK_ID)!;
    assert.deepEqual(
      stallStops,
      [{ taskId: MERGE_TASK_ID, chatId: MERGE_FIXER_CHAT_ID }],
      'fixer stall must be recorded as a stall-stop',
    );
    assert.equal(nudges.length, 0, 'fixer stall must not nudge — the finalizer owns recovery');
    assert.equal(selfHeals.length, 0, 'fixer stall must not self-heal directly');
    assert.equal(task.status, 'merging', 'stall-stop must not finalize');
    assert.equal(
      getTaskChatStallRestartCountForTests(MERGE_FIXER_CHAT_ID),
      0,
      'fixer stall-stop must not consume a nudge-restart slot',
    );
    assert.equal(
      isStallStoppedChatForTests(MERGE_FIXER_CHAT_ID),
      true,
      'chat must be marked so the stream-end preserves supervision state',
    );
    trackFixerStallStopsForTests(false);
  });
});

describe('Fix B — reconcileMergingTasks safety net', () => {
  const FIX_B_PLANNER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const FIX_B_GROUP_ID = 'grp_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const FIX_B_FIXER_CHAT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const FIX_B_TASK_BRANCH = 'minnow/board/W1-A';
  const prevMinnowTest = process.env.MINNOW_TEST;

  function makeFixBPlanner(): Chat {
    return {
      id: FIX_B_PLANNER_ID,
      name: 'Planner',
      workspacePath: '/tmp/ws',
      modeId: 'orchestrate',
      modelId: 'm1',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      orchestratePlanPath: 'documentation/plans/test.md',
      boardGroupId: FIX_B_GROUP_ID,
    };
  }

  function makeFixBFixerChat(): Chat {
    return {
      id: FIX_B_FIXER_CHAT_ID,
      name: 'Merge fixer W1-A',
      workspacePath: '/tmp/ws',
      modeId: 'build',
      modelId: 'm1',
      history: [
        { role: 'user', content: 'Resolve merge conflict' },
        { role: 'assistant', content: 'Conflict resolved and committed.' },
      ],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      boardGroupId: FIX_B_GROUP_ID,
      boardTaskId: 'W1-A',
    };
  }

  function makeFixBGroup(): ChatGroup {
    const planner = makeFixBPlanner();
    const group: ChatGroup = {
      id: FIX_B_GROUP_ID,
      name: 'Board',
      workspacePath: '/tmp/ws',
      collapsed: false,
      order: 0,
      plannerChatId: FIX_B_PLANNER_ID,
      orchestratePlanPath: 'documentation/plans/test.md',
      viewMode: 'board',
    };
    initBoard(group, planner, {
      planPath: 'documentation/plans/test.md',
      tasks: [
        {
          id: 'W1-A',
          title: 'Init',
          wave: 'W1',
          category: 'build',
          build: 'Add feature X',
          test: 'Run unit tests',
        },
      ],
      waves: [{ id: 'W1', status: 'in_progress' }],
    });
    return group;
  }

  function seedMergingWithDeadFixer(group: ChatGroup): { planner: Chat; fixerChat: Chat } {
    const planner = makeFixBPlanner();
    const fixerChat = makeFixBFixerChat();
    updateTask(
      group,
      'W1-A',
      {
        status: 'merging',
        fixerChatId: FIX_B_FIXER_CHAT_ID,
        worktreeBranch: FIX_B_TASK_BRANCH,
        mergePreSha: 'abc123',
      },
      planner,
    );
    setSessionStateForTests({
      chats: [planner, fixerChat],
      groups: [group],
      activeChatId: FIX_B_PLANNER_ID,
    });
    return { planner, fixerChat };
  }

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setSessionStateForTests(null);
    releaseLaunchSlotForTests(FIX_B_FIXER_CHAT_ID);
  });

  afterEach(() => {
    releaseLaunchSlotForTests(FIX_B_FIXER_CHAT_ID);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('reconcileMergingTasks routes inactive fixer out of merging', async () => {
    const group = makeFixBGroup();
    const { planner } = seedMergingWithDeadFixer(group);

    await reconcileMergingTasks(group, planner);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.notEqual(task.status, 'merging');
  });

  test('autoDelegateNext reconciles dead fixer before isBoardRunning gate', async () => {
    const group = makeFixBGroup();
    const { planner } = seedMergingWithDeadFixer(group);
    // Board not auto-running — reconcile should still run at top of autoDelegateNext.
    group.orchestrateBoard!.autoRunning = false;

    await autoDelegateNext(group, planner);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.notEqual(task.status, 'merging');
  });

  test('reconcileMergingTasks leaves live fixer in merging', async () => {
    const group = makeFixBGroup();
    const { planner } = seedMergingWithDeadFixer(group);
    reserveLaunchSlotForTests(FIX_B_FIXER_CHAT_ID);

    await reconcileMergingTasks(group, planner);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(task.status, 'merging');
  });
});

describe('Fix C — env-fixer unified stall recovery', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    teardownDom();
  });

  test('env-fixer stall at 3x stops the turn only — finalizer owns recovery', () => {
    const group = makeGroup();
    seedEnvFixerTask(group);
    const board = group.orchestrateBoard!;
    const task = board.tasks.find((t) => t.id === TASK_ID)!;

    const isFixerActive = (chatId: string) => chatId === FIXER_CHAT_ID;
    assert.equal(
      isTaskStalledForRestart(board, task, isFixerActive),
      false,
      'active env-fixer should not mark the task slot as stalled for restart',
    );

    trackTaskChatStallRecoveryCallsForTests(true);
    const stallStops = trackFixerStallStopsForTests(true);
    startTaskChatSupervisionForTests(FIXER_CHAT_ID);

    const runId = chatTaskRunId(FIXER_CHAT_ID);
    bumpProgress(runId);

    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);

    const { nudges, selfHeals } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(
      stallStops,
      [{ taskId: TASK_ID, chatId: FIXER_CHAT_ID }],
      'env-fixer stall must be recorded as a stall-stop',
    );
    assert.equal(nudges.length, 0, 'env-fixer stall must not nudge (double-dispatch race)');
    assert.equal(selfHeals.length, 0, 'env-fixer stall must not self-heal directly');
    assert.equal(
      getTaskChatStallRestartCountForTests(FIXER_CHAT_ID),
      0,
      'env-fixer stall-stop must not consume a nudge-restart slot',
    );
    trackFixerStallStopsForTests(false);
  });
});

describe('Env-fixer pass board_report routing', () => {
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setupDom();
    setSessionStateForTests(null);
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
  });

  afterEach(() => {
    teardownDom();
    releaseLaunchSlotForTests(FIXER_CHAT_ID);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('test-phase pass moves task to testing and clears fixer linkage', async () => {
    const group = makeGroup();
    const { planner } = seedEnvFixerTask(group);
    updateTask(
      group,
      TASK_ID,
      {
        envFixPhase: 'test',
        boardReport: { outcome: 'pass', summary: 'Deps installed' },
      },
      planner,
    );

    await triggerFixerStallReconcileForTests(group, planner, TASK_ID);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === TASK_ID)!;
    assert.equal(task.status, 'testing');
    assert.equal(task.fixerChatId, undefined);
    assert.equal(task.fixerKind, undefined);
    assert.equal(task.envFixPhase, undefined);
  });

  test('test-phase pass resumes testing before a queued sibling at maxConcurrent 1', async () => {
    const group = makeGroup();
    const planner = makePlanner();
    const fixerChat = makeEnvFixerChat();
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
        {
          id: 'W1-B',
          title: 'Task B',
          wave: 'W1',
          category: 'build',
          build: 'Build B',
          test: 'Run tests',
        },
      ],
      waves: [{ id: 'W1', status: 'in_progress' }],
    });
    group.orchestrateBoard!.executionMode = 'afk';
    group.orchestrateBoard!.autoRunning = true;
    group.orchestrateBoard!.maxConcurrentTasks = 1;

    updateTask(
      group,
      TASK_ID,
      {
        status: 'in_progress',
        chatId: BUILDER_CHAT_ID,
        fixerChatId: FIXER_CHAT_ID,
        fixerKind: 'env',
        envFixPhase: 'test',
        worktreePath: '/ws',
        boardReport: { outcome: 'pass', summary: 'Services up' },
      },
      planner,
    );
    updateTask(group, 'W1-B', { status: 'planned' }, planner);
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, makeBuilderChat(), fixerChat],
      groups: [group],
    });

    reserveLaunchSlotForTests(FIXER_CHAT_ID);
    enqueueTaskForTests(GROUP_ID, 'W1-B');
    trackDrainResumeCallsForTests(true);

    await triggerFixerStallReconcileForTests(group, planner, TASK_ID);
    for (let i = 0; i < 20; i += 1) {
      const taskA = group.orchestrateBoard!.tasks.find((t) => t.id === TASK_ID)!;
      if (taskA.status === 'testing') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const taskA = group.orchestrateBoard!.tasks.find((t) => t.id === TASK_ID)!;
    const taskB = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    const board = group.orchestrateBoard!;
    trackDrainResumeCallsForTests(false);

    assert.equal(taskA.status, 'testing', 'env-fixed task should advance to testing');
    assert.equal(taskB.status, 'planned', 'queued sibling must not start while A resumes testing');
    assert.ok(taskA.testChatId?.trim(), 'test-phase pass must create or bind a tester chat');
    const testChatId = taskA.testChatId!.trim();
    assert.equal(
      isLaunchReservedForTests(testChatId),
      false,
      'tester launch reservation must not leak when testing cannot launch immediately',
    );
    const queue = getTaskQueueForTests(GROUP_ID);
    if (queue.includes(TASK_ID)) {
      assert.equal(queue[0], TASK_ID, 'front-insert keeps env-fixed task ahead of siblings');
    }

    releaseLaunchSlotForTests(FIXER_CHAT_ID);
    assert.equal(
      countRunningTaskChats(board),
      0,
      'leaked tester reservation must not leave the board at max concurrency',
    );
  });

  test('resumeBoardTask succeeds when a pre-reserved tester chat exists', async () => {
    const group = makeGroup();
    const planner = makePlanner();
    const testChatId = 'eeee-eeee-tester';
    updateTask(
      group,
      TASK_ID,
      {
        status: 'testing',
        chatId: BUILDER_CHAT_ID,
        testChatId,
        worktreePath: '/ws',
      },
      planner,
    );
    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [
        planner,
        makeBuilderChat(),
        {
          id: testChatId,
          name: 'Test W1-A',
          workspacePath: '/ws',
          modeId: 'build',
          modelId: 'm1',
          history: [],
          lastStats: null,
          modelInfo: {},
          updatedAt: 1,
          boardGroupId: GROUP_ID,
          boardTaskId: TASK_ID,
        },
      ],
      groups: [group],
    });

    reserveLaunchSlotForTests(testChatId);
    group.orchestrateBoard!.maxConcurrentTasks = 1;

    await continueBoardTask(group, TASK_ID, planner);

    assert.equal(
      isLaunchReservedForTests(testChatId),
      false,
      'resume must not leave a leaked tester reservation',
    );
  });
});

const FIX_D_PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const FIX_D_GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const FIX_D_TASK_CHAT_ID = '33333333-3333-3333-3333-333333333333';

function makeFixDPlanner(): Chat {
  return {
    id: FIX_D_PLANNER_ID,
    name: 'Planner',
    workspacePath: '/tmp/ws',
    modeId: 'orchestrate',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    orchestratePlanPath: 'documentation/plans/test.md',
    boardGroupId: FIX_D_GROUP_ID,
  };
}

function makeFixDStoppedTaskChat(runStopReason?: 'user' | 'system'): Chat {
  const chat: Chat = {
    id: FIX_D_TASK_CHAT_ID,
    name: 'Task W1-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Execute task' },
      { role: 'assistant', content: 'Partial work…', stopped: true },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: FIX_D_GROUP_ID,
    boardTaskId: 'W1-A',
  };
  if (runStopReason) {
    chat.runs = [
      {
        runId: 'run_stop_1',
        branchId: 'b1',
        forkHistoryIndex: 0,
        status: 'stopped',
        stopReason: runStopReason,
        createdAt: 10,
        snapshot: null as any,
      },
    ];
  }
  return chat;
}

function makeFixDRunningGroup(): { group: ChatGroup; planner: Chat } {
  const planner = makeFixDPlanner();
  const group: ChatGroup = {
    id: FIX_D_GROUP_ID,
    name: 'Board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    plannerChatId: FIX_D_PLANNER_ID,
    orchestratePlanPath: 'documentation/plans/test.md',
    viewMode: 'board',
  };
  initBoard(
    group,
    planner,
    {
      planPath: 'documentation/plans/test.md',
      tasks: [{ id: 'W1-A', title: 'Init', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1', status: 'in_progress' }],
    },
  );
  updateTask(
    group,
    'W1-A',
    { status: 'in_progress', chatId: FIX_D_TASK_CHAT_ID, startedAt: 1 },
    planner,
  );
  group.orchestrateBoard!.executionMode = 'auto';
  group.orchestrateBoard!.autoRunning = true;
  setSessionStateForTests({
    chats: [planner, makeFixDStoppedTaskChat()],
    groups: [group],
    activeChatId: FIX_D_PLANNER_ID,
  });
  return { group, planner };
}

describe('Fix D — systemPaused vs user Stop', () => {
  beforeEach(async () => {
    resetOrchestratorAutoReportsForTests();
    setOrchestratorReportDeliverHook(async () => {});
    setSessionStateForTests(null);
    const { Window } = await import('happy-dom');
    const window = new Window();
    const g = globalThis as typeof globalThis & {
      localStorage: Storage;
      document: Document;
      HTMLElement: typeof HTMLElement;
      requestAnimationFrame: typeof requestAnimationFrame;
    };
    g.localStorage = window.localStorage;
    g.document = window.document;
    g.HTMLElement = window.HTMLElement;
    g.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  afterEach(() => {
    resetOrchestratorAutoReportsForTests();
    setOrchestratorReportDeliverHook(null);
  });

  test('systemPaused finalizes to planned with stopRetries, not quarantine', () => {
    const { group, planner } = makeFixDRunningGroup();
    const board = group.orchestrateBoard!;
    board.systemPaused = true;
    board.userStopped = false;

    const task = board.tasks[0]!;
    finalizeBoardTaskOnStreamEnd(group, task, planner);

    const updated = board.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'planned');
    assert.equal(updated.stopRetries, 1);
    assert.equal(updated.quarantine, undefined);
    assert.equal(updated.chatId, undefined);
  });

  test('userStopped without systemPaused quarantines on stream-end', async () => {
    const { group, planner } = makeFixDRunningGroup();
    const board = group.orchestrateBoard!;
    board.userStopped = true;
    board.systemPaused = false;

    const task = board.tasks[0]!;
    const taskChat = makeFixDStoppedTaskChat('user');
    setSessionStateForTests({
      chats: [planner, taskChat],
      groups: [group],
      activeChatId: FIX_D_PLANNER_ID,
    });
    finalizeBoardTaskOnStreamEnd(group, task, planner);
    await new Promise((resolve) => setImmediate(resolve));

    const updated = board.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'quarantined');
    assert.equal(updated.chatId, undefined);
    assert.match(updated.quarantine?.summary ?? '', /stopped by user/i);
    assert.equal(
      isTaskStalledForRestart(board, updated, () => false),
      false,
    );
  });

  test('systemPaused takes precedence when both flags are set', () => {
    const { group, planner } = makeFixDRunningGroup();
    const board = group.orchestrateBoard!;
    board.systemPaused = true;
    board.userStopped = true;

    const task = board.tasks[0]!;
    finalizeBoardTaskOnStreamEnd(group, task, planner);

    const updated = board.tasks.find((t) => t.id === 'W1-A')!;
    assert.equal(updated.status, 'planned');
    assert.equal(updated.stopRetries, 1);
    assert.equal(updated.quarantine, undefined);
  });

  test('stopBoardAutoRun reason system sets systemPaused only', () => {
    const { group, planner } = makeFixDRunningGroup();
    stopBoardAutoRun(group, planner, { reason: 'system' });

    const board = group.orchestrateBoard!;
    assert.equal(board.autoRunning, false);
    assert.equal(board.systemPaused, true);
    assert.equal(board.userStopped, false);
  });

  test('stopBoardAutoRun default reason sets userStopped only', () => {
    const { group, planner } = makeFixDRunningGroup();
    stopBoardAutoRun(group, planner);

    const board = group.orchestrateBoard!;
    assert.equal(board.autoRunning, false);
    assert.equal(board.userStopped, true);
    assert.equal(board.systemPaused, false);
  });

  test('startBoardAutoRun clears userStopped and systemPaused', () => {
    const { group, planner } = makeFixDRunningGroup();
    const board = group.orchestrateBoard!;
    board.userStopped = true;
    board.systemPaused = true;
    board.autoRunning = false;

    startBoardAutoRun(group, planner);

    assert.equal(board.autoRunning, true);
    assert.equal(board.userStopped, false);
    assert.equal(board.systemPaused, false);
  });
});

describe('Manual recovery — recoverMergingBoardTask', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setupDom();
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    teardownDom();
    setLocalServerAvailableForTests(false);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('finalizeMergeFixerOnStreamEnd git fallback completes when fixer dead without board_report', async () => {
    const group = makeMergeGroup();
    const fixerChat = makeMergeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: true },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === MERGE_TASK_ID)!;
    await finalizeMergeFixerOnStreamEndForTests(group, task, planner, MERGE_FIXER_CHAT_ID);

    const taskAfter = group.orchestrateBoard!.tasks.find((t) => t.id === MERGE_TASK_ID)!;
    assert.equal(taskAfter.status, 'complete');
    assert.equal(taskAfter.fixerChatId, undefined);
    assert.equal(taskAfter.boardReport, undefined);
  });

  test('recoverMergingBoardTask with dead fixer and verified merge completes task', async () => {
    const group = makeMergeGroup();
    const fixerChat = makeMergeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: true },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    updateTask(
      group,
      MERGE_TASK_ID,
      { boardReport: { outcome: 'pass', summary: 'Merge committed' } },
      planner,
    );

    await recoverMergingBoardTask(group, MERGE_TASK_ID, planner);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === MERGE_TASK_ID)!;
    assert.equal(task.status, 'complete');
    assert.equal(task.fixerChatId, undefined);
    assert.equal(task.mergePreSha, undefined);
  });

  test('continueBoardTask on merging delegates to reconcile without resetting to in_progress', async () => {
    const group = makeMergeGroup();
    const fixerChat = makeMergeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: false },
      verify_integration: { ok: true, verified: false },
    });

    trackReconcileMergingTasksCallsForTests(true);
    await continueBoardTask(group, MERGE_TASK_ID, planner);
    const reconcileCalls = trackReconcileMergingTasksCallsForTests(false);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === MERGE_TASK_ID)!;
    assert.ok(reconcileCalls >= 1, 'continue on merging should invoke reconcileMergingTasks');
    assert.notEqual(task.status, 'in_progress', 'must not reset merging via builder recovery');
  });

  test('restartBoardTask on merging stops fixer supervision then reconciles', async () => {
    const group = makeMergeGroup();
    const fixerChat = makeMergeFixerChat();
    const { planner } = seedMergingTask(group, fixerChat);
    reserveLaunchSlotForTests(MERGE_FIXER_CHAT_ID);

    restoreFetch = mockWorktreeOps({
      check_merged: { ok: true, merged: true },
      verify_integration: { ok: true, verified: true },
      refresh_integration_deps: { ok: true },
    });

    updateTask(
      group,
      MERGE_TASK_ID,
      { boardReport: { outcome: 'pass', summary: 'Merge committed' } },
      planner,
    );

    await restartBoardTask(group, MERGE_TASK_ID, planner);
    releaseLaunchSlotForTests(MERGE_FIXER_CHAT_ID);

    const task = group.orchestrateBoard!.tasks.find((t) => t.id === MERGE_TASK_ID)!;
    assert.equal(task.status, 'complete');
    assert.equal(task.fixerChatId, undefined);
  });
});

describe('waitForNoActiveFixer timeout', () => {
  let restoreFetch: (() => void) | undefined;
  const prevMinnowTest = process.env.MINNOW_TEST;

  const TIMEOUT_GROUP_ID = 'grp_eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const TIMEOUT_PLANNER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const STALE_FIXER_CHAT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const SIBLING_BRANCH = 'minnow/board/W1-C';

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    setLocalServerAvailableForTests(true);
    setSessionStateForTests(null);
    setMaxFixerWaitMsForTests(null);
    trackReconcileMergingTasksCallsForTests(false);
    releaseLaunchSlotForTests(STALE_FIXER_CHAT_ID);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    setLocalServerAvailableForTests(false);
    setMaxFixerWaitMsForTests(null);
    trackReconcileMergingTasksCallsForTests(false);
    releaseLaunchSlotForTests(STALE_FIXER_CHAT_ID);
    if (prevMinnowTest === undefined) {
      delete process.env.MINNOW_TEST;
    } else {
      process.env.MINNOW_TEST = prevMinnowTest;
    }
    setSessionStateForTests(null);
  });

  test('timeout reconciles and sibling merge proceeds despite falsely-active fixer', async () => {
    const planner: Chat = {
      id: TIMEOUT_PLANNER_ID,
      name: 'Planner',
      workspacePath: '/tmp/ws',
      modeId: 'orchestrate',
      modelId: 'm1',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      orchestratePlanPath: 'documentation/plans/test.md',
      boardGroupId: TIMEOUT_GROUP_ID,
    };
    const group: ChatGroup = {
      id: TIMEOUT_GROUP_ID,
      name: 'Board',
      workspacePath: '/tmp/ws',
      collapsed: false,
      order: 0,
      plannerChatId: TIMEOUT_PLANNER_ID,
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
      boardGroupId: TIMEOUT_GROUP_ID,
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
      activeChatId: TIMEOUT_PLANNER_ID,
    });

    // Stale launch reservation makes the fixer look active until timeout reconcile runs.
    reserveLaunchSlotForTests(STALE_FIXER_CHAT_ID);
    trackReconcileMergingTasksCallsForTests(true);
    setMaxFixerWaitMsForTests(50);

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

    assert.equal(raced.kind, 'resolved', 'sibling merge should not hang on falsely-active fixer');
    if (raced.kind === 'resolved') {
      assert.equal(raced.result.outcome, 'merged');
    }

    const reconcileCalls = trackReconcileMergingTasksCallsForTests(false);
    assert.ok(reconcileCalls >= 1, 'wait timeout should invoke reconcileMergingTasks');

    // Known medium-risk: falsely-active fixer may remain merging while sibling merge proceeds.
    const stuck = group.orchestrateBoard!.tasks.find((t) => t.id === 'W1-B')!;
    assert.equal(stuck.status, 'merging');
  });
});
