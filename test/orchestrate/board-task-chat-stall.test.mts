/**
 * MIN-286 Part 5b — board task-chat stall detection in AFK/auto mode.
 *
 * Heartbeat ticks kill the stuck turn and increment the stall-restart counter.
 * Continue-nudge / self-heal run on stream-end after the chat is actually idle.
 *
 * Uses setSessionStateForTests + tickHeartbeatForTests to avoid real timers.
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { setAutopilotMetaForTests, resetAutopilotMetaCache } from '../../src/config/autopilot-meta.ts';
import {
  awaitBoardChatContinuationsForTests,
  clearStallStoppedChatIdsForTests,
  clearTaskChatStallRestartsForTests,
  flushBoardChatContinuationsForTests,
  getTaskChatStallRestartCountForTests,
  isStallStoppedChatForTests,
  simulateUnmatchedFixerStreamEndForTests,
  startTaskChatSupervisionForTests,
  trackTaskChatStallRecoveryCallsForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import {
  resetSessionPersistenceForTests,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { setChatAbort, setStreaming } from '../../src/app-state.ts';
import {
  bumpProgress,
  chatTaskRunId,
  resetHeartbeatBaselines,
  resetWrapperState,
  simulatePageVisibilityForTests,
  tickHeartbeatForTests,
} from '../../src/agents/controller/wrapper.ts';
import type { Chat, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';

const PLANNER_ID = 'aaaa-aaaa-planner';
const TASK_CHAT_ID = 'bbbb-bbbb-task';
const TEST_CHAT_ID = 'cccc-cccc-test';
const GROUP_ID = 'grp_aaaa-aaaa';
const TASK_ID = 'W1-A';
const PROGRESS_STALL_MS = 10_000;
/** stall threshold used in startTaskChatSupervision = 3 × progressStallMs */
const STALL_THRESHOLD_MS = 3 * PROGRESS_STALL_MS;

let now = 0;
let originalNow: typeof performance.now;
let domWindow: Window | undefined;

function setupDom(): void {
  domWindow = new Window();
  globalThis.document = domWindow.document;
  globalThis.window = domWindow as unknown as Window & typeof globalThis.window;
}

async function teardownDom(): Promise<void> {
  // Window.close() is a no-op for a root happy-dom window (no opener). Abort
  // the detached browser so its timers and fetches cannot keep node:test alive.
  const api = domWindow?.happyDOM;
  if (api && typeof api.close === 'function') {
    await api.close();
  } else {
    domWindow?.close();
  }
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
    boardGroupId: GROUP_ID,
  };
}

function makeTaskChat(): Chat {
  return {
    id: TASK_CHAT_ID,
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

function makeBoard(
  executionMode: 'manual' | 'sequential' | 'auto' | 'afk' = 'afk',
  autoRunning = true,
): OrchestrateBoardState {
  return {
    planPath: 'plan.md',
    startedAt: 1,
    lastUpdatedAt: 2,
    waves: [{ id: 'W1', status: 'in_progress' }],
    tasks: [
      {
        id: TASK_ID,
        title: 'Task A',
        wave: 'W1',
        category: 'build',
        status: 'in_progress',
        chatId: TASK_CHAT_ID,
      },
    ],
    executionMode,
    autoRunning,
  };
}

function makeGroup(executionMode: 'manual' | 'sequential' | 'auto' | 'afk' = 'afk'): ChatGroup {
  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Board',
    workspacePath: '/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PLANNER_ID,
    orchestrateBoard: makeBoard(executionMode),
  };
  return group;
}

function armLiveTurn(chatId: string): void {
  // Live turns abort locally; stopGeneration must not flushStoppedChatPresentation
  // (that path notifies stream-end immediately and would hide the heartbeat/stream-end split).
  setChatAbort(chatId, new AbortController());
  setStreaming(true, chatId);
}

function disarmLiveTurn(chatId: string): void {
  setChatAbort(chatId, null);
  setStreaming(false, chatId);
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

  setAutopilotMetaForTests({
    progressStallMs: PROGRESS_STALL_MS,
    heartbeatIntervalMs: 100,
    heartbeatDeadMs: 10_000,
  });
});

afterEach(async () => {
  performance.now = originalNow;
  // Drop live-turn flags first so queued stall recovery can finish, then wait.
  setChatAbort(TASK_CHAT_ID, null);
  setChatAbort(TEST_CHAT_ID, null);
  setStreaming(false);
  await awaitBoardChatContinuationsForTests();
  resetWrapperState();
  resetAutopilotMetaCache();
  clearTaskChatStallRestartsForTests();
  clearStallStoppedChatIdsForTests();
  trackTaskChatStallRecoveryCallsForTests(false);
  setSessionStateForTests(null);
  resetSessionPersistenceForTests();
  await teardownDom();
});

describe('board task-chat stall detection', () => {
  test('stalled AFK chat: heartbeat kills only — no immediate nudge', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    armLiveTurn(TASK_CHAT_ID);
    trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);

    bumpProgress(chatTaskRunId(TASK_CHAT_ID));
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(chatTaskRunId(TASK_CHAT_ID));

    const { nudges, selfHeals } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(nudges, [], 'heartbeat must not nudge while the turn is still tearing down');
    assert.deepEqual(selfHeals, []);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);
    assert.equal(isStallStoppedChatForTests(TASK_CHAT_ID), true);
  });

  test('recent bumpProgress prevents stall restart', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    now = STALL_THRESHOLD_MS + 100;
    bumpProgress(runId);

    tickHeartbeatForTests(runId);
    tickHeartbeatForTests(runId);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 0);
  });

  test('manual mode: stall detection does not restart', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('manual');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    tickHeartbeatForTests(runId);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 0);
  });

  test('sequential mode: stall tick kills only; stream-end nudges', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('sequential');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    armLiveTurn(TASK_CHAT_ID);
    const captured = trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    assert.deepEqual(captured.nudges, [], 'heartbeat must not nudge');
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);

    disarmLiveTurn(TASK_CHAT_ID);
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);
    assert.deepEqual(captured.nudges, [TASK_ID], 'sequential stall must nudge like afk/auto after stream-end');
    trackTaskChatStallRecoveryCallsForTests(false);
  });

  test('stall counter survives the stall-stop stream end; second stall self-heals', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    armLiveTurn(TASK_CHAT_ID);
    trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);

    disarmLiveTurn(TASK_CHAT_ID);
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);
    assert.equal(
      getTaskChatStallRestartCountForTests(TASK_CHAT_ID),
      1,
      'stall-stop stream end must preserve the restart counter',
    );

    armLiveTurn(TASK_CHAT_ID);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    bumpProgress(runId);
    now += STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    disarmLiveTurn(TASK_CHAT_ID);
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);

    const { nudges, selfHeals } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(nudges, [TASK_ID], 'only the first stall should nudge');
    assert.deepEqual(selfHeals, [TASK_ID], 'second stall must escalate to self-heal');
  });

  test('natural stream end still clears the stall counter', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    armLiveTurn(TASK_CHAT_ID);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    disarmLiveTurn(TASK_CHAT_ID);
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);

    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    bumpProgress(runId);
    taskChat.history.push({ role: 'assistant', content: 'Done.' });
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);
    assert.equal(
      getTaskChatStallRestartCountForTests(TASK_CHAT_ID),
      0,
      'natural stream end must clear the restart counter',
    );
  });

  test('visibility baseline reset does not false-stall after fresh progress bump', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    now = 4_000_000;
    resetHeartbeatBaselines();
    bumpProgress(runId);

    now = 4_000_000 + 7_000;
    tickHeartbeatForTests(runId);

    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 0);
  });

  test('stalled tester chat nudges the test chat, not the builder', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const testChat: Chat = {
      id: TEST_CHAT_ID,
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
    };
    const group = makeGroup('afk');
    const board = group.orchestrateBoard!;
    board.tasks[0] = {
      ...board.tasks[0]!,
      status: 'testing',
      testChatId: TEST_CHAT_ID,
    };

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat, testChat],
      groups: [group],
    });

    armLiveTurn(TEST_CHAT_ID);
    trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TEST_CHAT_ID);

    bumpProgress(chatTaskRunId(TEST_CHAT_ID));
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(chatTaskRunId(TEST_CHAT_ID));
    disarmLiveTurn(TEST_CHAT_ID);
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TEST_CHAT_ID);

    const { nudges, nudgeChatIds } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(nudges, [TASK_ID]);
    assert.deepEqual(nudgeChatIds, [TEST_CHAT_ID], 'nudge must target the stalled tester chat');
    assert.equal(getTaskChatStallRestartCountForTests(TEST_CHAT_ID), 1);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 0, 'builder chat must not stall-restart');
  });

  test('stall with null lastProgressAt does not restart', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 0);
  });

  test('hidden page past stall threshold does not nudge or stop', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    bumpProgress(runId);
    simulatePageVisibilityForTests('hidden');
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);

    const { nudges } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(nudges, [], 'stall watchdog must not fire while the page is hidden');
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 0);
  });

  test('production order: no launch while streaming; nudge after setStreaming(false)', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('afk');

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    armLiveTurn(TASK_CHAT_ID);
    const captured = trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    assert.deepEqual(captured.nudges, [], 'stall tick must not launch a nudge');

    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);
    assert.deepEqual(captured.nudges, [], 'stream-end while still streaming must not launch');

    disarmLiveTurn(TASK_CHAT_ID);
    await flushBoardChatContinuationsForTests(TASK_CHAT_ID);
    assert.deepEqual(captured.nudges, [TASK_ID], 'first stall recovers with a continue-nudge after teardown');
    assert.deepEqual(captured.selfHeals, []);
    trackTaskChatStallRecoveryCallsForTests(false);
  });
});
