/**
 * Notification producer tests for task_quarantined and board_complete (MIN-287).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('quarantine + board_complete notification producers', () => {
  let store;
  let producers;
  let sessions;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.localStorage = win.localStorage;

    store = await import('../../src/notifications/store.ts');
    producers = await import('../../src/notifications/producers.ts');
    sessions = await import('../../src/state/sessions.ts');

    store.resetNotificationStoreForTests();
    producers.resetNotificationProducersForTests();
    sessions.setSessionStateForTests({
      version: 5,
      activeId: 'planner-1',
      chats: [],
      groups: [],
    });
  });

  afterEach(() => {
    store.resetNotificationStoreForTests();
    producers.resetNotificationProducersForTests();
    sessions.setSessionStateForTests(null);
  });

  function makeBoard(tasks, unresolvedIssues) {
    return {
      planPath: 'docs/plans/test.md',
      startedAt: 1,
      lastUpdatedAt: 2,
      waves: [{ id: 'W1', status: 'planned' }],
      tasks,
      ...(unresolvedIssues ? { unresolvedIssues } : {}),
    };
  }

  function makeGroup(board) {
    return {
      id: 'grp-1',
      name: 'Board',
      workspacePath: '/ws',
      collapsed: false,
      order: 0,
      createdAt: 1,
      plannerChatId: 'planner-1',
      orchestrateBoard: board,
    };
  }

  test('quarantined transition emits task_quarantined notification', () => {
    const board = makeBoard([
      { id: 'T1', title: 'Build db', wave: 'W1', category: 'build', status: 'in_progress' },
    ]);
    sessions.setSessionStateForTests({
      version: 5,
      activeId: 'planner-1',
      chats: [],
      groups: [makeGroup(board)],
    });

    // Simulate transition: T1 moves from in_progress (seeded) to quarantined
    producers.__testHooks.handleBoardChange('grp-1');
    // T1 is in_progress → no quarantine yet
    assert.equal(store.getNotifications().filter((n) => n.kind === 'task_quarantined').length, 0);

    // Now move T1 to quarantined
    board.tasks[0].status = 'quarantined';
    producers.__testHooks.handleBoardChange('grp-1');

    const quarantinedNotifs = store.getNotifications().filter((n) => n.kind === 'task_quarantined');
    assert.equal(quarantinedNotifs.length, 1);
    assert.match(quarantinedNotifs[0].preview, /quarantined/);
    assert.equal(quarantinedNotifs[0].title, 'Build db');
  });

  test('all-terminal board emits board_complete with unresolved count', () => {
    const board = makeBoard(
      [
        { id: 'T1', title: 'Task One', wave: 'W1', category: 'build', status: 'complete' },
        { id: 'T2', title: 'Task Two', wave: 'W1', category: 'build', status: 'quarantined' },
      ],
      [
        { taskId: 'T2', title: 'Task Two', category: 'code', summary: 'Failed', resolutionSteps: ['fix'], createdAt: 1 },
      ],
    );
    sessions.setSessionStateForTests({
      version: 5,
      activeId: 'planner-1',
      chats: [],
      groups: [makeGroup(board)],
    });

    producers.__testHooks.handleBoardChange('grp-1');

    const boardCompleteNotifs = store.getNotifications().filter((n) => n.kind === 'board_complete');
    assert.equal(boardCompleteNotifs.length, 1);
    assert.match(boardCompleteNotifs[0].preview, /1 unresolved issue/);
  });

  test('GAP-1: all-quarantined zero-complete board emits board_blocked', () => {
    const board = makeBoard(
      [
        { id: 'T1', title: 'Task One', wave: 'W1', category: 'build', status: 'quarantined' },
        { id: 'T2', title: 'Task Two', wave: 'W1', category: 'build', status: 'quarantined' },
      ],
      [
        { taskId: 'T1', title: 'Task One', category: 'infra', summary: 'DB down', resolutionSteps: ['start db'], createdAt: 1 },
        { taskId: 'T2', title: 'Task Two', category: 'code', summary: 'Failed', resolutionSteps: ['fix'], createdAt: 2 },
      ],
    );
    sessions.setSessionStateForTests({
      version: 5,
      activeId: 'planner-1',
      chats: [],
      groups: [makeGroup(board)],
    });

    producers.__testHooks.handleBoardChange('grp-1');

    const blockedNotifs = store.getNotifications().filter((n) => n.kind === 'board_blocked');
    assert.equal(blockedNotifs.length, 1, 'should emit exactly one board_blocked');
    assert.match(blockedNotifs[0].preview, /Blocked — 2 quarantined/);
  });

  test('board_blocked fires only once even on repeated handleBoardChange calls', () => {
    const board = makeBoard([
      { id: 'T1', title: 'Task One', wave: 'W1', category: 'build', status: 'quarantined' },
    ]);
    sessions.setSessionStateForTests({
      version: 5,
      activeId: 'planner-1',
      chats: [],
      groups: [makeGroup(board)],
    });

    producers.__testHooks.handleBoardChange('grp-1');
    producers.__testHooks.handleBoardChange('grp-1');
    producers.__testHooks.handleBoardChange('grp-1');

    const blockedNotifs = store.getNotifications().filter((n) => n.kind === 'board_blocked');
    assert.equal(blockedNotifs.length, 1, 'board_blocked should fire only once');
  });

  test('seedBoardTaskStatuses suppresses board_complete for already-complete boards', () => {
    const board = makeBoard([
      { id: 'T1', title: 'Task One', wave: 'W1', category: 'build', status: 'quarantined' },
    ]);
    sessions.setSessionStateForTests({
      version: 5,
      activeId: 'planner-1',
      chats: [],
      groups: [makeGroup(board)],
    });

    // initNotificationProducers seeds and should suppress the spurious fire
    producers.initNotificationProducers();
    // Board was already complete at init time — no board_complete should fire
    const boardCompleteNotifs = store.getNotifications().filter((n) => n.kind === 'board_complete');
    assert.equal(boardCompleteNotifs.length, 0, 'should not fire board_complete for already-complete boards at init');
  });
});
