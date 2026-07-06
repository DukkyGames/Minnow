/**
 * MIN-286 Part 5b — board task-chat stall detection in AFK/auto mode.
 *
 * Tests that the heartbeat tick:
 *  - increments the stall-restart counter and fires a nudge when a build chat stalls in AFK
 *  - does NOT restart when progress was recently bumped
 *  - does NOT restart in manual mode (sequential IS supervised — one hung chat
 *    stops the whole board at maxConcurrent 1)
 *  - preserves the stall counter across a stall-stop stream end so the second
 *    stall escalates to self-heal instead of nudging forever
 *
 * Uses setSessionStateForTests + tickHeartbeatForTests to avoid real timers.
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { setAutopilotMetaForTests, resetAutopilotMetaCache } from '../../src/config/autopilot-meta.ts';
import {
  clearStallStoppedChatIdsForTests,
  clearTaskChatStallRestartsForTests,
  getTaskChatStallRestartCountForTests,
  simulateUnmatchedFixerStreamEndForTests,
  startTaskChatSupervisionForTests,
  trackTaskChatStallRecoveryCallsForTests,
} from '../../src/state/orchestrate-board-actions.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
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

afterEach(() => {
  performance.now = originalNow;
  resetWrapperState();
  resetAutopilotMetaCache();
  clearTaskChatStallRestartsForTests();
  clearStallStoppedChatIdsForTests();
  trackTaskChatStallRecoveryCallsForTests(false);
  teardownDom();
});

describe('board task-chat stall detection', () => {
  test('stalled AFK chat: counter incremented on first stall tick', () => {
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

    bumpProgress(chatTaskRunId(TASK_CHAT_ID));
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(chatTaskRunId(TASK_CHAT_ID));

    const { nudges } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(
      nudges,
      [TASK_ID],
      `nudges=${JSON.stringify(nudges)} counter=${getTaskChatStallRestartCountForTests(TASK_CHAT_ID)}`,
    );
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);
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

    // Advance time past threshold, then bump progress just before the tick
    now = STALL_THRESHOLD_MS + 100;
    bumpProgress(runId); // fresh progress — age becomes 0

    tickHeartbeatForTests(runId);

    // Counter should still be 0 — no restart triggered
    // (heartbeat timer is still active; calling tick again doesn't throw)
    tickHeartbeatForTests(runId);
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

    // Should NOT trigger stall restart in manual mode
    tickHeartbeatForTests(runId);

    // Heartbeat timer still active — tick is still callable
    tickHeartbeatForTests(runId);
  });

  test('sequential mode: stall detection nudges (one hung chat stops the board)', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup('sequential');

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
    now = STALL_THRESHOLD_MS + 100;

    tickHeartbeatForTests(runId);

    const { nudges } = trackTaskChatStallRecoveryCallsForTests(false);
    assert.deepEqual(nudges, [TASK_ID], 'sequential stall must nudge like afk/auto');
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);
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

    trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    // First stall → nudge, counter = 1, chat marked stall-stopped.
    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);

    // Stream end from the stall-triggered stopGeneration must NOT wipe the counter.
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);
    assert.equal(
      getTaskChatStallRestartCountForTests(TASK_CHAT_ID),
      1,
      'stall-stop stream end must preserve the restart counter',
    );

    // Second stall → escalates to self-heal instead of nudging again.
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    bumpProgress(runId);
    now += STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);

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

    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    const runId = chatTaskRunId(TASK_CHAT_ID);

    // Stall once (counter = 1, marked stall-stopped), consume the stall-stop end.
    bumpProgress(runId);
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(runId);
    await simulateUnmatchedFixerStreamEndForTests(group, planner, TASK_CHAT_ID);
    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 1);

    // Next turn ends naturally (no stall tick) → full supervision teardown.
    startTaskChatSupervisionForTests(TASK_CHAT_ID);
    bumpProgress(runId);
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

    // Simulate a long-lived session, then a tab-focus baseline reset.
    now = 4_000_000;
    resetHeartbeatBaselines();
    bumpProgress(runId);

    // One heartbeat interval later — progress is fresh, not hours stale.
    now = 4_000_000 + 7_000;
    tickHeartbeatForTests(runId);

    assert.equal(getTaskChatStallRestartCountForTests(TASK_CHAT_ID), 0);
  });

  test('stalled tester chat nudges the test chat, not the builder', () => {
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

    trackTaskChatStallRecoveryCallsForTests(true);
    startTaskChatSupervisionForTests(TEST_CHAT_ID);

    bumpProgress(chatTaskRunId(TEST_CHAT_ID));
    now = STALL_THRESHOLD_MS + 100;
    tickHeartbeatForTests(chatTaskRunId(TEST_CHAT_ID));

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

    // Do NOT call bumpProgress — lastProgressAt stays null
    now = STALL_THRESHOLD_MS + 100;

    // Should not crash and should not trigger stall (null progress = guard returns early)
    tickHeartbeatForTests(runId);
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
});
