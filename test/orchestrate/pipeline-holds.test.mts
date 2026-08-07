/**
 * Pipeline hold module — occupancy TTL-on-read and stall-restart guard integration.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  acquirePipelineHold,
  countHeldTaskIds,
  hasPipelineHold,
  releasePipelineHold,
  releasePipelineHoldsForTask,
  setPipelineHoldMaxMsForTests,
} from '../../src/state/orchestrate-pipeline-holds.ts';
import {
  initBoard,
  isTaskStalledForRestart,
  updateTask,
} from '../../src/state/orchestrate-board-store.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TEST_CHAT_ID = '44444444-4444-4444-4444-444444444444';

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
    orchestratePlanPath: 'documentation/plans/test.md',
    boardGroupId: GROUP_ID,
  };
}

function makeBoardGroup(): ChatGroup {
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
  initBoard(group, planner, {
    planPath: 'documentation/plans/test.md',
    tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
    waves: [{ id: 'W1' }],
  });
  return group;
}

describe('pipeline holds', () => {
  afterEach(() => {
    setPipelineHoldMaxMsForTests(null);
  });

  test('isTaskStalledForRestart false while held, true once released', () => {
    const group = makeBoardGroup();
    const planner = makePlanner();
    const board = group.orchestrateBoard!;
    updateTask(
      group,
      'W1-A',
      { status: 'testing', testChatId: TEST_CHAT_ID, chatId: 'build-chat' },
      planner,
    );
    const task = board.tasks[0]!;
    assert.equal(isTaskStalledForRestart(board, task, () => false), true);
    const hold = acquirePipelineHold(board, 'W1-A', 'merge');
    assert.ok(hold);
    assert.equal(isTaskStalledForRestart(board, task, () => false), false);
    releasePipelineHold(hold);
    assert.equal(isTaskStalledForRestart(board, task, () => false), true);
  });

  test('TTL-on-read: expired hold is invisible to hasPipelineHold and countHeldTaskIds', () => {
    const group = makeBoardGroup();
    const board = group.orchestrateBoard!;
    setPipelineHoldMaxMsForTests(1);
    const hold = acquirePipelineHold(board, 'W1-A', 'merge');
    assert.ok(hold);
    // Pin nowMs to acquisition time so slow CI cannot expire the hold between reads.
    const whileFresh = hold.acquiredAt;
    assert.equal(hasPipelineHold(board, 'W1-A', whileFresh), true);
    assert.equal(countHeldTaskIds(board, undefined, whileFresh), 1);
    const afterTtl = hold.acquiredAt + 2;
    assert.equal(hasPipelineHold(board, 'W1-A', afterTtl), false);
    assert.equal(countHeldTaskIds(board, undefined, afterTtl), 0);
    releasePipelineHoldsForTask(board, 'W1-A');
  });

  test('logger context receives acquire and TTL expiry with post-event counts', () => {
    const group = makeBoardGroup();
    const board = group.orchestrateBoard!;
    const seen: Array<{ action: string; holdId: string; active: number }> = [];
    setPipelineHoldMaxMsForTests(1);
    const hold = acquirePipelineHold(board, 'W1-A', 'merge', {
      onEvent(action, current, active) {
        seen.push({ action, holdId: current.id, active });
      },
    });
    assert.ok(hold);
    // Advance logical time past TTL to trigger expiry-on-read without wall-clock races.
    assert.equal(hasPipelineHold(board, 'W1-A', hold.acquiredAt + 2), false);
    assert.deepEqual(seen, [
      { action: 'acquire', holdId: hold.id, active: 1 },
      { action: 'expiry', holdId: hold.id, active: 0 },
    ]);
  });
});
