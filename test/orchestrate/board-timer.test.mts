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
import type { Chat, OrchestrateBoardState } from '../../src/types.ts';

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

function boardWithTask(status: 'planned' | 'in_progress' = 'planned'): OrchestrateBoardState {
  const chat = makeChat();
  initBoard(chat, {
    planPath: PLAN_PATH,
    tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
    waves: [{ id: 'W1' }],
  });
  if (status === 'in_progress') {
    chat.orchestrateBoard!.tasks[0].status = 'in_progress';
  }
  return chat.orchestrateBoard!;
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

  test('syncOrchestrateBoardTimer accumulates only while active', () => {
    const chat = makeChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    const board = chat.orchestrateBoard!;

    board.activeParentTurnId = 'turn-1';
    setBoardNowForTests(() => T0);
    syncOrchestrateBoardTimer(chat, {
      isStreaming: true,
      activeRunCount: 0,
      userStopped: false,
    });
    assert.equal(board.timerSegmentStartedAt, T0);

    setBoardNowForTests(() => T1);
    assert.equal(getOrchestrateBoardElapsedMs(board, T1), 5_000);

    setBoardNowForTests(() => T1);
    syncOrchestrateBoardTimer(chat, {
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
