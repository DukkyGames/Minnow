/**
 * Orchestrate board header timer: runs while active, pauses when idle/stopped.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  getOrchestrateBoardElapsedMs,
  initBoard,
  setBoardNowForTests,
  shouldOrchestrateBoardTimerRun,
  syncOrchestrateBoardTimer,
} from '../../src/state/orchestrate-board-store.ts';
import type { Chat, ChatGroup, OrchestrateBoardState } from '../../src/types.ts';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';

const PLAN_PATH = 'documentation/plans/shiny-minsky-board-view.md';
const FIXED_NOW = 1710000001000;
const T0 = FIXED_NOW;
const T1 = FIXED_NOW + 5_000;
const T2 = FIXED_NOW + 12_000;

function makeChat(): Chat {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Timer Test',
    workspacePath: '',
    modelId: 'test-model',
    modeId: 'orchestrate',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_NOW,
  };
}

function makeGroup(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Timer',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: FIXED_NOW,
  };
}

function boardWithTask(status: 'planned' | 'in_progress' = 'planned'): OrchestrateBoardState {
  const chat = makeChat();
  const group = makeGroup();
  initBoard(group, chat, {
    planPath: PLAN_PATH,
    tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
    waves: [{ id: 'W1' }],
  });
  if (status === 'in_progress') {
    group.orchestrateBoard!.tasks[0].status = 'in_progress';
  }
  return group.orchestrateBoard!;
}

describe('orchestrate board timer', () => {
  beforeEach(() => {
    setBoardNowForTests(() => T0);
  });

  test('shouldOrchestrateBoardTimerRun is false when idle and user stopped', () => {
    const board = boardWithTask('planned');
    assert.equal(
      shouldOrchestrateBoardTimerRun(board, {
        isStreaming: false,
        activeRunCount: 0,
        userStopped: true,
      }),
      false,
    );
    assert.equal(
      shouldOrchestrateBoardTimerRun(board, {
        isStreaming: false,
        activeRunCount: 0,
        userStopped: false,
      }),
      false,
    );
  });

  test('shouldOrchestrateBoardTimerRun is true when parent streams with activeParentTurnId', () => {
    const board = boardWithTask('planned');
    board.activeParentTurnId = 'turn-abc';
    assert.equal(
      shouldOrchestrateBoardTimerRun(board, {
        isStreaming: true,
        activeRunCount: 0,
        userStopped: false,
      }),
      true,
    );
  });

  test('timer freezes the instant the user stops, even with tasks still in_progress', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    const board = group.orchestrateBoard!;
    board.tasks[0].status = 'in_progress';

    // Run the timer for 5s while the task streams.
    board.activeParentTurnId = 'turn-1';
    setBoardNowForTests(() => T0);
    syncOrchestrateBoardTimer(group, chat, {
      isStreaming: true,
      activeRunCount: 1,
      userStopped: false,
    });
    assert.equal(board.timerSegmentStartedAt, T0);

    // User presses Stop at T1: persist the flag and close the segment now.
    board.userStopped = true;
    setBoardNowForTests(() => T1);
    syncOrchestrateBoardTimer(group, chat, {
      isStreaming: false,
      activeRunCount: 0,
      userStopped: true,
    });
    assert.equal(board.timerAccumulatedMs, 5_000);
    assert.equal(board.timerSegmentStartedAt, undefined);

    // Even though the task is still in_progress, the timer must not resume on a
    // later tick because userStopped short-circuits shouldOrchestrateBoardTimerRun.
    assert.equal(
      shouldOrchestrateBoardTimerRun(board, {
        isStreaming: false,
        activeRunCount: 0,
        userStopped: true,
      }),
      false,
    );
    setBoardNowForTests(() => T2);
    syncOrchestrateBoardTimer(group, chat, {
      isStreaming: false,
      activeRunCount: 0,
      userStopped: true,
    });
    assert.equal(board.timerSegmentStartedAt, undefined);
    assert.equal(getOrchestrateBoardElapsedMs(board, T2), 5_000);
  });

  test('syncOrchestrateBoardTimer accumulates only while active', () => {
    const chat = makeChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    const board = group.orchestrateBoard!;

    board.activeParentTurnId = 'turn-1';
    setBoardNowForTests(() => T0);
    syncOrchestrateBoardTimer(group, chat, {
      isStreaming: true,
      activeRunCount: 0,
      userStopped: false,
    });
    assert.equal(board.timerSegmentStartedAt, T0);

    setBoardNowForTests(() => T1);
    assert.equal(getOrchestrateBoardElapsedMs(board, T1), 5_000);

    setBoardNowForTests(() => T1);
    syncOrchestrateBoardTimer(group, chat, {
      isStreaming: false,
      activeRunCount: 0,
      userStopped: false,
    });
    assert.equal(board.timerAccumulatedMs, 5_000);
    assert.equal(board.timerSegmentStartedAt, undefined);

    setBoardNowForTests(() => T2);
    assert.equal(getOrchestrateBoardElapsedMs(board, T2), 5_000);
  });
});
