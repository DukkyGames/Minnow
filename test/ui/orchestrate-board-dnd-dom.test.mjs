/**
 * Phase 3 board DOM: cards are draggable, columns are drop targets, status-move
 * buttons are gone, and the header carries the run-help and bulk-recovery controls.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals, teardownHappyDomAsync } from '../os/dom-helpers.mts';

const FIXED_CHAT_ID = '51111111-1111-1111-1111-111111111111';
const FIXED_GROUP_ID = 'grp_51111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { initBoard, updateTask, setBoardNowForTests } = await import(
  '../../src/state/orchestrate-board-store.ts'
);
const { renderBoardView, disposeBoardViewForTests } = await import(
  '../../src/ui/orchestrate-board.ts'
);
const { clearBoardListenersForTests } = await import(
  '../../src/state/orchestrate-board-events.ts'
);
const { loadSubAgentConfig, resetSubAgentConfigCache, setRuntimeSubAgentOverrides } =
  await import('../../src/agents/sub-agent-config.ts');

/** @type {import('happy-dom').Window | undefined} */
let win;
let savedFetch;

function installTestFetch() {
  savedFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/api/config/meta')) {
      return Response.json({ terminal: { open: false, tabs: [], activeTabId: null } });
    }
    return Response.json({ ok: true });
  };
}

function setupDom() {
  win = new Window();
  installTestFetch();
  installHappyDomGlobals(win, { fetch: globalThis.fetch });
  globalThis.HTMLSelectElement = win.HTMLSelectElement;
  for (const id of ['chatArea', 'mainColumn', 'msgInput']) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  const modelSelect = document.createElement('select');
  modelSelect.id = 'modelSelect';
  document.body.appendChild(modelSelect);
}

async function primeSubAgentConfig() {
  resetSubAgentConfigCache();
  setRuntimeSubAgentOverrides({
    globalMaxConcurrent: 4,
    types: { builder: { enabled: true, maxConcurrent: 2 } },
  });
  await loadSubAgentConfig();
}

async function waitForKanban() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (document.querySelector('.kanban-grid')) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('kanban grid not rendered');
}

function makeBoard(tasks) {
  const chat = createEmptyChatObject('');
  chat.id = FIXED_CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.viewMode = 'board';
  chat.orchestratePlanPath = PLAN_PATH;

  const group = {
    id: FIXED_GROUP_ID,
    name: 'Fixture Board',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: chat.id,
    orchestratePlanPath: PLAN_PATH,
    viewMode: 'board',
  };
  initBoard(group, chat, {
    planPath: PLAN_PATH,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      wave: 'W1',
      category: 'build',
    })),
    waves: [{ id: 'W1' }],
  });
  chat.boardGroupId = group.id;
  chat.groupId = group.id;
  for (const t of tasks) {
    if (t.status) updateTask(group, t.id, { status: t.status });
  }
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    activeBoardGroupId: group.id,
    sidebarCollapsed: false,
    chats: [chat],
    groups: [group],
  });
  return group;
}

describe('orchestrate board drag affordances (Phase 3)', { concurrency: false }, () => {
  afterEach(async () => {
    disposeBoardViewForTests();
    clearBoardListenersForTests();
    setSessionStateForTests(null);
    setBoardNowForTests(null);
    resetSubAgentConfigCache();
    if (savedFetch) globalThis.fetch = savedFetch;
    await teardownHappyDomAsync(win);
    win = undefined;
  });

  test('cards are draggable and carry their status; merging cards are not', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const group = makeBoard([
      { id: 'W1-A', title: 'Task A', status: 'planned' },
      { id: 'W1-B', title: 'Task B', status: 'merging' },
    ]);

    renderBoardView(group);
    await waitForKanban();

    const planned = document.querySelector('[data-board-task-id="W1-A"]');
    assert.ok(planned, 'planned card rendered');
    assert.equal(planned.getAttribute('draggable'), 'true');
    assert.equal(planned.getAttribute('data-board-task-status'), 'planned');

    const merging = document.querySelector('[data-board-task-id="W1-B"]');
    assert.ok(merging, 'merging card rendered');
    assert.notEqual(
      merging.getAttribute('draggable'),
      'true',
      'a mid-merge card must not be draggable',
    );
  });

  test('status-move buttons are gone; recoverable cards keep Requeue and Reset', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const group = makeBoard([
      { id: 'W1-A', title: 'Task A', status: 'planned' },
      { id: 'W1-B', title: 'Task B', status: 'failed' },
    ]);

    renderBoardView(group);
    await waitForKanban();

    const plannedActions = [
      ...document
        .querySelector('[data-board-task-id="W1-A"]')
        .querySelectorAll('.board-task-card__advance-label'),
    ].map((el) => el.textContent);
    assert.deepEqual(
      plannedActions,
      [],
      'a planned card has no status-move button — that is a drag now',
    );

    const failedActions = [
      ...document
        .querySelector('[data-board-task-id="W1-B"]')
        .querySelectorAll('.board-task-card__advance-label'),
    ].map((el) => el.textContent);
    assert.ok(failedActions.includes('Requeue'), 'failed cards get a real Requeue');
    assert.ok(failedActions.includes('Reset'), 'and a Reset for a fresh worktree');
    assert.equal(
      failedActions.includes('Reopen'),
      false,
      'the fake Reopen that left buildAttempts maxed is gone',
    );
  });

  test('header carries the run-settings help button', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const group = makeBoard([{ id: 'W1-A', title: 'Task A', status: 'planned' }]);

    renderBoardView(group);
    await waitForKanban();

    const help = document.querySelector('[data-board-action="run-help"]');
    assert.ok(help, 'run-settings explainer is reachable from the header');
    assert.equal(help.getAttribute('aria-label'), 'About run settings');
  });

  test('bulk recovery control appears only when a task is recoverable', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const group = makeBoard([{ id: 'W1-A', title: 'Task A', status: 'planned' }]);

    renderBoardView(group);
    await waitForKanban();
    assert.equal(
      document.querySelector('[data-board-action="bulk-requeue"]'),
      null,
      'nothing failed yet, so no bulk control',
    );

    disposeBoardViewForTests();
    const failedGroup = makeBoard([
      { id: 'W1-A', title: 'Task A', status: 'failed' },
      { id: 'W1-B', title: 'Task B', status: 'quarantined' },
    ]);
    renderBoardView(failedGroup);
    await waitForKanban();

    const bulk = document.querySelector('[data-board-action="bulk-requeue"]');
    assert.ok(bulk, 'bulk control shows once tasks are recoverable');
    assert.equal(
      bulk.querySelector('.board-header__bulk-requeue-primary').textContent,
      'Requeue 2 failed',
    );
    assert.ok(group);
  });
});
