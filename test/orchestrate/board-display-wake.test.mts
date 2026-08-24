/**
 * Display wake reconcile — replay board stream-end finalizers after macOS display sleep.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetAutopilotMetaCache } from '../../src/config/autopilot-meta.ts';
import {
  onBoardAutoRunStarted,
  onBoardAutoRunStopped,
  resetAfkBoardPowerGuardForTests,
  getAfkBoardPowerGuardRefCountForTests,
} from '../../src/chat/orchestrate/board-afk-power.ts';
import {
  reconcileRunningBoardsAfterDisplayWake,
} from '../../src/state/orchestrate-board-actions.ts';
import { resetBoardDisplayWakeLivenessForTests } from '../../src/chat/orchestrate/board-display-wake.ts';
import { registerOrchestrateBoardShutdownHandler, resetOrchestrateBoardShutdownRegistrationForTests } from '../../src/chat/orchestrate/board-shutdown.ts';
import { setStreaming } from '../../src/app-state.ts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TASK_CHAT_ID = '22222222-2222-2222-2222-222222222222';

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
    boardGroupId: GROUP_ID,
  };
}

function makeTaskChat(): Chat {
  return {
    id: TASK_CHAT_ID,
    name: 'Task W1-A',
    workspacePath: '/tmp/ws',
    modeId: 'build',
    modelId: 'm1',
    history: [
      { role: 'user', content: 'Execute task' },
      { role: 'assistant', content: 'Done.' },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    boardGroupId: GROUP_ID,
    boardTaskId: 'W1-A',
  };
}

function makeGroup(): ChatGroup {
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
  initBoard(
    group,
    planner,
    {
      planPath: 'documentation/plans/test.md',
      tasks: [
        {
          id: 'W1-A',
          title: 'Init',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    },
  );
  const board = group.orchestrateBoard!;
  board.handsOff = true;
  board.autoRunning = true;
  board.tasks[0] = {
    ...board.tasks[0]!,
    status: 'in_progress',
    chatId: TASK_CHAT_ID,
    boardReport: { outcome: 'pass', summary: 'ok' },
  };
  return group;
}

describe('board display wake reconcile', () => {
  /** @type {import('happy-dom').Window | undefined} */
  let happyDomWindow: import('happy-dom').Window | undefined;

  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
    happyDomWindow = new Window();
    globalThis.window = happyDomWindow;
    globalThis.document = happyDomWindow.document;
  });

  afterEach(() => {
    delete process.env.MINNOW_TEST;
    resetAutopilotMetaCache();
    resetAfkBoardPowerGuardForTests();
    resetOrchestrateBoardShutdownRegistrationForTests();
    resetBoardDisplayWakeLivenessForTests();
    setStreaming(false);
    happyDomWindow?.close();
    happyDomWindow = undefined;
    // @ts-expect-error test teardown
    delete globalThis.window;
    // @ts-expect-error test teardown
    delete globalThis.document;
  });

  test('reconcile advances in_progress task when build chat already finished', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup();

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    await reconcileRunningBoardsAfterDisplayWake();

    const task = group.orchestrateBoard!.tasks[0]!;
    assert.equal(task.status, 'testing');
  });

  test('reconcile advances when streaming flag stuck after completed build', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup();

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    setStreaming(true, TASK_CHAT_ID);

    await reconcileRunningBoardsAfterDisplayWake();

    const task = group.orchestrateBoard!.tasks[0]!;
    assert.equal(task.status, 'testing');
  });

  test('reconcile auto-resumes system-paused board and advances finished build', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup();
    const board = group.orchestrateBoard!;
    board.autoRunning = false;
    board.systemPaused = true;

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    await reconcileRunningBoardsAfterDisplayWake();

    assert.equal(board.autoRunning, true);
    assert.equal(board.systemPaused, false);
    assert.equal(board.tasks[0]!.status, 'testing');
  });

  test('reconcile does not auto-resume after user Stop', async () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup();
    const board = group.orchestrateBoard!;
    board.autoRunning = false;
    board.systemPaused = true;
    board.userStopped = true;

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    await reconcileRunningBoardsAfterDisplayWake();

    assert.equal(board.autoRunning, false);
    assert.equal(board.tasks[0]!.status, 'in_progress');
  });

  test('quit shutdown hook system-pauses running boards', () => {
    const planner = makePlanner();
    const taskChat = makeTaskChat();
    const group = makeGroup();

    setSessionStateForTests({
      version: 5,
      activeId: PLANNER_ID,
      chats: [planner, taskChat],
      groups: [group],
    });

    resetOrchestrateBoardShutdownRegistrationForTests();
    registerOrchestrateBoardShutdownHandler();
    assert.equal(typeof window.__minnowPauseBoardsForShutdown, 'function');

    window.__minnowPauseBoardsForShutdown!();

    assert.equal(group.orchestrateBoard!.autoRunning, false);
    assert.equal(group.orchestrateBoard!.systemPaused, true);
  });

  test('AFK power guard ref-count tracks board start/stop', () => {
    assert.equal(getAfkBoardPowerGuardRefCountForTests(), 0);
    onBoardAutoRunStarted();
    onBoardAutoRunStarted();
    assert.equal(getAfkBoardPowerGuardRefCountForTests(), 2);
    onBoardAutoRunStopped();
    assert.equal(getAfkBoardPowerGuardRefCountForTests(), 1);
    onBoardAutoRunStopped();
    assert.equal(getAfkBoardPowerGuardRefCountForTests(), 0);
  });
});
