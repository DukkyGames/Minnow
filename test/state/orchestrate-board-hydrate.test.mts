/**
 * Orchestrate board session hydration: autoRunning, executionMode, finalTest.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { STORAGE_KEY } from '../../src/constants.ts';
import {
  stopBoardAutoRun,
  setBoardExecutionMode,
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

function seedRunningBoard(executionMode: 'auto' | 'sequential' = 'auto') {
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
  board.executionMode = executionMode;
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

  test('restores afk executionMode and autoRunning', () => {
    const [group] = hydrateSessionGroupsForTests([
      {
        ...PERSISTED_GROUP,
        orchestrateBoard: {
          ...PERSISTED_GROUP.orchestrateBoard,
          executionMode: 'afk',
          autoRunning: true,
        },
      },
    ]);
    assert.equal(group.orchestrateBoard?.executionMode, 'afk');
    assert.equal(group.orchestrateBoard?.autoRunning, true);
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
    const { planner, group } = seedRunningBoard('auto');
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

  test('setBoardExecutionMode manual persists stopped state without debounced flush', () => {
    const { planner, group } = seedRunningBoard('sequential');
    saveSessionsNow();
    assert.equal(
      readPersistedGroupsFromLocalStorage()[0]?.orchestrateBoard?.autoRunning,
      true,
    );

    setBoardExecutionMode(group, 'manual', planner);

    const [persisted] = readPersistedGroupsFromLocalStorage();
    assert.ok(persisted);
    assert.equal(persisted.orchestrateBoard?.executionMode, 'manual');
    assert.equal(persisted.orchestrateBoard?.autoRunning, undefined);
    assert.equal(isBoardRunning(persisted), false);
  });
});
