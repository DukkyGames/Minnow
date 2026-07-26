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

  test('TTL-on-read: expired hold is invisible to hasPipelineHold and countHeldTaskIds', async () => {
    const group = makeBoardGroup();
    const board = group.orchestrateBoard!;
    setPipelineHoldMaxMsForTests(1);
    const hold = acquirePipelineHold(board, 'W1-A', 'merge');
    assert.ok(hold);
    assert.equal(hasPipelineHold(board, 'W1-A'), true);
    assert.equal(countHeldTaskIds(board), 1);
    await new Promise<void>((r) => setTimeout(r, 5));
    assert.equal(hasPipelineHold(board, 'W1-A'), false);
    assert.equal(countHeldTaskIds(board), 0);
    releasePipelineHoldsForTask(board, 'W1-A');
  });
});
