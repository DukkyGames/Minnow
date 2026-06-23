/**
 * Board timeline drawer: mount, render, live append, cleanup.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_NOW = 1710000001000;
const PLAN_PATH = 'documentation/plans/timeline-drawer-fixture.md';

const { setSessionStateForTests } = await import('../../src/state/sessions.ts');
const {
  appendBoardLog,
  initBoard,
  resetBoardLogForTests,
  setBoardLogSeqForTests,
  setBoardNowForTests,
} = await import('../../src/state/orchestrate-board-store.ts');
const { clearBoardListenersForTests } = await import(
  '../../src/state/orchestrate-board-events.ts'
);
const {
  openBoardTimelineDrawer,
  closeBoardTimelineDrawer,
} = await import('../../src/ui/board-timeline-drawer.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  const main = document.createElement('div');
  main.id = 'mainColumn';
  document.body.appendChild(main);
}

function seedGroup() {
  const group = {
    id: GROUP_ID,
    name: 'Timeline Test',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: FIXED_NOW,
  };
  const chat = {
    id: CHAT_ID,
    name: 'Planner',
    workspacePath: '',
    modelId: 'm1',
    modeId: 'orchestrate',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_NOW,
  };
  initBoard(group, chat, {
    planPath: PLAN_PATH,
    tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
    waves: [{ id: 'W1' }],
  });
  group.orchestrateBoard!.log = [
    {
      id: '1710000001000-0',
      ts: FIXED_NOW,
      type: 'board_init',
      level: 'info',
      message: 'Board initialized (1 tasks, 1 waves)',
    },
    {
      id: '1710000001000-1',
      ts: FIXED_NOW + 1,
      type: 'tool_call',
      level: 'info',
      taskId: 'W1-A',
      message: 'W1-A: read_file',
    },
    {
      id: '1710000001000-2',
      ts: FIXED_NOW + 2,
      type: 'task_status',
      level: 'error',
      taskId: 'W1-A',
      message: 'W1-A: planned → failed',
    },
  ];
  setBoardLogSeqForTests(3);
  setSessionStateForTests({
    version: 5,
    activeId: CHAT_ID,
    sidebarCollapsed: false,
    chats: [chat],
    groups: [group],
  });
  return group;
}

afterEach(() => {
  closeBoardTimelineDrawer();
  clearBoardListenersForTests();
  setBoardNowForTests(null);
  resetBoardLogForTests();
  setSessionStateForTests(null);
});

describe('openBoardTimelineDrawer', () => {
  test('mounts panel, renders log rows, live-appends on board change, and closes cleanly', () => {
    setupDom();
    setBoardNowForTests(() => FIXED_NOW);
    resetBoardLogForTests();
    const group = seedGroup();

    openBoardTimelineDrawer(GROUP_ID);
    const panel = document.querySelector('.board-timeline-drawer-panel');
    assert.ok(panel);
    assert.ok(document.getElementById('mainColumn')?.querySelector('.board-timeline-drawer-panel'));

    let rows = document.querySelectorAll('.board-timeline-drawer__row');
    assert.equal(rows.length, 3);

    appendBoardLog(group, {
      type: 'auto_start',
      level: 'info',
      message: 'Auto execution started',
    });

    rows = document.querySelectorAll('.board-timeline-drawer__row');
    assert.equal(rows.length, 4);
    assert.match(rows[rows.length - 1]?.textContent ?? '', /Auto execution started/);

    closeBoardTimelineDrawer();
    assert.equal(document.querySelector('.board-timeline-drawer-panel'), null);
  });
});
