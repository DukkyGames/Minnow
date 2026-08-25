/**
 * Orchestrate board session hydration: autoRunning, hands-off, concurrency, finalTest.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { STORAGE_KEY } from '../../src/constants.ts';
import {
  stopBoardAutoRun,
  setBoardHandsOff,
} from '../../src/state/orchestrate-board-actions.ts';
import { initBoard, isBoardRunning } from '../../src/state/orchestrate-board-store.ts';
import {
  hydrateSessionGroupsForTests,
  saveSessionsNow,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/reload-persist.md';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';

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
    orchestratePlanPath: PLAN_PATH,
    boardGroupId: GROUP_ID,
  };
}

function makeGroup(): ChatGroup {
  return {
    id: GROUP_ID,
    name: 'Reload board',
    workspacePath: '/tmp/ws',
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestratePlanPath: PLAN_PATH,
    plannerChatId: PLANNER_ID,
  };
}

function seedRunningBoard(concurrency = 3) {
  const planner = makePlanner();
  const group = makeGroup();
  initBoard(group, planner, {
    planPath: PLAN_PATH,
    waves: [{ id: 'W1' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'First task',
        wave: 'W1',
        category: 'build',
        build: 'Do work',
      },
    ],
  });
  const board = group.orchestrateBoard!;
  board.maxConcurrentTasks = concurrency;
  board.autoRunning = true;
  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner],
    groups: [group],
  });
  return { planner, group };
}

/** Read persisted groups from localStorage without flushing debounced saves. */
function readPersistedGroupsFromLocalStorage(): ChatGroup[] {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  assert.ok(raw, 'expected session snapshot in localStorage');
  const parsed = JSON.parse(raw) as { groups?: unknown };
  return hydrateSessionGroupsForTests(parsed.groups ?? []);
}

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
  test('migrates legacy sequential to concurrency 1 and restores finalTest', () => {
    const [group] = hydrateSessionGroupsForTests([PERSISTED_GROUP]);
    assert.ok(group);
    const board = group.orchestrateBoard;
    assert.ok(board);
    assert.equal(board.executionMode, undefined);
    assert.equal(board.maxConcurrentTasks, 1);
    assert.equal(board.handsOff, undefined);
    assert.equal(board.autoRunning, true);
    assert.equal(board.finalTest?.status, 'in_progress');
    assert.equal(board.finalTest?.chatId, '33333333-3333-3333-3333-333333333333');
    assert.equal(board.finalTest?.attempts, 1);
    assert.equal(board.tasks[0]?.status, 'in_progress');
    assert.equal(board.tasks[0]?.chatId, '22222222-2222-2222-2222-222222222222');
    assert.equal(isBoardRunning(group), true);
  });

  test('restores quarantined tasks and quarantine payload after reload', () => {
    const [group] = hydrateSessionGroupsForTests([
      {
        ...PERSISTED_GROUP,
        orchestrateBoard: {
          ...PERSISTED_GROUP.orchestrateBoard,
          autoRunning: false,
          tasks: [
            {
              id: 'W1-A',
              title: 'Stalled build',
              wave: 'W1',
              category: 'build',
              status: 'quarantined',
              quarantine: {
                category: 'stall',
                summary: 'Generation stopped',
                resolutionSteps: ['Requeue the task'],
                at: 1710000002000,
              },
            },
            {
              id: 'W1-B',
              title: 'Dependent task',
              wave: 'W1',
              category: 'test',
              status: 'quarantined',
              dependsOn: ['W1-A'],
              quarantine: {
                category: 'stall',
                summary: 'blocked by quarantined W1-A',
                resolutionSteps: [],
                at: 1710000002001,
              },
            },
          ],
        },
      },
    ]);
    assert.ok(group.orchestrateBoard);
    assert.equal(group.orchestrateBoard?.tasks.length, 2);
    const root = group.orchestrateBoard?.tasks.find((t) => t.id === 'W1-A');
    const dependent = group.orchestrateBoard?.tasks.find((t) => t.id === 'W1-B');
    assert.equal(root?.status, 'quarantined');
    assert.equal(root?.quarantine?.category, 'stall');
    assert.equal(root?.quarantine?.summary, 'Generation stopped');
    assert.deepEqual(root?.quarantine?.resolutionSteps, ['Requeue the task']);
    assert.equal(dependent?.status, 'quarantined');
    assert.equal(dependent?.quarantine?.summary, 'blocked by quarantined W1-A');
  });

  function hydrateWithBoard(patch: Record<string, unknown>) {
    const [group] = hydrateSessionGroupsForTests([
      {
        ...PERSISTED_GROUP,
        orchestrateBoard: { ...PERSISTED_GROUP.orchestrateBoard, ...patch },
      },
    ]);
    return group;
  }

  test('legacy afk migrates to handsOff and keeps autoRunning', () => {
    const group = hydrateWithBoard({ executionMode: 'afk', autoRunning: true });
    assert.equal(group.orchestrateBoard?.executionMode, undefined);
    assert.equal(group.orchestrateBoard?.handsOff, true);
    assert.equal(group.orchestrateBoard?.autoRunning, true);
    assert.equal(isBoardRunning(group), true);
  });

  test('legacy auto keeps its concurrency and stays interactive', () => {
    const group = hydrateWithBoard({
      executionMode: 'auto',
      maxConcurrentTasks: 5,
      autoRunning: true,
    });
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 5);
    assert.equal(group.orchestrateBoard?.handsOff, undefined);
  });

  test('legacy manual migrates to concurrency 1, stopped', () => {
    const group = hydrateWithBoard({ executionMode: 'manual', autoRunning: true });
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 1);
    assert.equal(group.orchestrateBoard?.autoRunning, undefined);
    assert.equal(isBoardRunning(group), false);
  });

  test('junk executionMode is dropped and leaves the board untouched', () => {
    const group = hydrateWithBoard({
      executionMode: 'turbo',
      maxConcurrentTasks: 4,
      autoRunning: false,
    });
    assert.equal(group.orchestrateBoard?.executionMode, undefined);
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 4);
    assert.equal(group.orchestrateBoard?.autoRunning, undefined);
    assert.equal(isBoardRunning(group), false);
  });

  test('worktreeSlug survives a round trip', () => {
    const group = hydrateWithBoard({ worktreeSlug: 'checkout-flow' });
    assert.equal(group.orchestrateBoard?.worktreeSlug, 'checkout-flow');
  });

  test('restores board diagnostic log events on reload', () => {
    const log = [
      {
        id: '1710000001000-0',
        ts: 1710000001000,
        type: 'task_status',
        level: 'info',
        taskId: 'W1-A',
        message: 'W1-A: planned → in_progress',
        detail: { from: 'planned', to: 'in_progress' },
      },
      {
        id: '1710000001000-1',
        ts: 1710000001001,
        type: 'auto_start',
        level: 'info',
        message: 'Auto-pilot started',
      },
    ];
    const [group] = hydrateSessionGroupsForTests([
      {
        ...PERSISTED_GROUP,
        orchestrateBoard: {
          ...PERSISTED_GROUP.orchestrateBoard,
          log,
        },
      },
    ]);
    assert.deepEqual(group.orchestrateBoard?.log, log);
  });
});

describe('orchestrate board stop persistence', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    const g = globalThis as typeof globalThis & { localStorage: Storage };
    g.localStorage = window.localStorage;
    g.document = window.document;
    g.HTMLElement = window.HTMLElement;
    window.localStorage.clear();
  });

  afterEach(() => {
    setSessionStateForTests(null);
    globalThis.localStorage?.clear?.();
  });

  test('stopBoardAutoRun persists stopped state without debounced flush', () => {
    const { planner, group } = seedRunningBoard(3);
    saveSessionsNow();
    assert.equal(
      readPersistedGroupsFromLocalStorage()[0]?.orchestrateBoard?.autoRunning,
      true,
    );

    stopBoardAutoRun(group, planner);

    const [persisted] = readPersistedGroupsFromLocalStorage();
    assert.ok(persisted);
    assert.equal(persisted.orchestrateBoard?.autoRunning, undefined);
    assert.equal(isBoardRunning(persisted), false);
  });

  test('setBoardHandsOff persists hands-off without a stored mode string', () => {
    const { planner, group } = seedRunningBoard(1);
    saveSessionsNow();
    assert.equal(
      readPersistedGroupsFromLocalStorage()[0]?.orchestrateBoard?.autoRunning,
      true,
    );

    setBoardHandsOff(group, true, planner);
    saveSessionsNow();

    const [persisted] = readPersistedGroupsFromLocalStorage();
    assert.ok(persisted);
    assert.equal(persisted.orchestrateBoard?.handsOff, true);
    assert.equal(persisted.orchestrateBoard?.executionMode, undefined);
    // Hands-off is available at concurrency 1 — it does not lift the cap.
    assert.equal(persisted.orchestrateBoard?.maxConcurrentTasks, 1);

    setBoardHandsOff(group, false, planner);
    saveSessionsNow();
    assert.equal(
      readPersistedGroupsFromLocalStorage()[0]?.orchestrateBoard?.handsOff,
      undefined,
    );
  });
});
