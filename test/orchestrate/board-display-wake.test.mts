/**
 * Display wake reconcile — replay board stream-end finalizers after macOS display sleep.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
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
  board.executionMode = 'afk';
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
  beforeEach(() => {
    process.env.MINNOW_TEST = '1';
  });

  afterEach(() => {
    delete process.env.MINNOW_TEST;
    resetAutopilotMetaCache();
    resetAfkBoardPowerGuardForTests();
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
