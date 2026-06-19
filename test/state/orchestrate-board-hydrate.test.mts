/**
 * Orchestrate board session hydration: autoRunning, executionMode, finalTest.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hydrateSessionGroupsForTests } from '../../src/state/sessions.ts';
import { isBoardRunning } from '../../src/state/orchestrate-board-store.ts';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/reload-persist.md';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';

/** Minimal persisted group blob with a running sequential board. */
const PERSISTED_GROUP = {
  id: GROUP_ID,
  name: 'Reload board',
  workspacePath: 'C:\\workspace\\demo',
  collapsed: false,
  order: 0,
  createdAt: 1710000000000,
  plannerChatId: PLANNER_ID,
  orchestratePlanPath: PLAN_PATH,
  orchestrateBoard: {
    planPath: PLAN_PATH,
    executionMode: 'sequential',
    autoRunning: true,
    startedAt: 1710000000000,
    lastUpdatedAt: 1710000001000,
    finalTest: {
      status: 'in_progress',
      chatId: '33333333-3333-3333-3333-333333333333',
      attempts: 1,
    },
    tasks: [
      {
        id: 'W1-A',
        title: 'First task',
        wave: 'W1',
        category: 'build',
        status: 'in_progress',
        chatId: '22222222-2222-2222-2222-222222222222',
      },
    ],
    waves: [{ id: 'W1', status: 'in_progress' }],
  },
};

describe('orchestrate board hydration', () => {
  test('restores autoRunning, sequential executionMode, and finalTest', () => {
    const [group] = hydrateSessionGroupsForTests([PERSISTED_GROUP]);
    assert.ok(group);
    const board = group.orchestrateBoard;
    assert.ok(board);
    assert.equal(board.executionMode, 'sequential');
    assert.equal(board.autoRunning, true);
    assert.equal(board.finalTest?.status, 'in_progress');
    assert.equal(board.finalTest?.chatId, '33333333-3333-3333-3333-333333333333');
    assert.equal(board.finalTest?.attempts, 1);
    assert.equal(board.tasks[0]?.status, 'in_progress');
    assert.equal(board.tasks[0]?.chatId, '22222222-2222-2222-2222-222222222222');
    assert.equal(isBoardRunning(group), true);
  });

  test('drops autoRunning when false and coerces unknown executionMode to manual', () => {
    const [group] = hydrateSessionGroupsForTests([
      {
        ...PERSISTED_GROUP,
        orchestrateBoard: {
          ...PERSISTED_GROUP.orchestrateBoard,
          executionMode: 'turbo',
          autoRunning: false,
        },
      },
    ]);
    assert.equal(group.orchestrateBoard?.executionMode, 'manual');
    assert.equal(group.orchestrateBoard?.autoRunning, undefined);
    assert.equal(isBoardRunning(group), false);
  });

  test('manual mode with autoRunning true does not count as running', () => {
    const [group] = hydrateSessionGroupsForTests([
      {
        ...PERSISTED_GROUP,
        orchestrateBoard: {
          ...PERSISTED_GROUP.orchestrateBoard,
          executionMode: 'manual',
          autoRunning: true,
        },
      },
    ]);
    assert.equal(isBoardRunning(group), false);
  });
});
