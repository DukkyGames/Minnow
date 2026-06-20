/**
 * Board view live updates: subscriptions on empty board + in-place kanban refresh.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const FIXED_EXTERNAL_CHAT_ID = '44444444-4444-4444-4444-444444444444';
const FIXED_RUN_ID = '22222222-2222-2222-2222-222222222222';
const FIXED_TASK_CHAT_ID = '33333333-3333-3333-3333-333333333333';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const {
  setSessionStateForTests,
  createEmptyChatObject,
  getActiveChat,
} = await import('../../src/state/sessions.ts');
const { initBoard, updateTask, setBoardNowForTests } = await import(
  '../../src/state/orchestrate-board-store.ts'
);
const {
  renderBoardView,
  refreshActiveBoardIfMounted,
  disposeBoardViewForTests,
  deriveBoardHeaderStatus,
  canOpenBoardTaskSubAgent,
  deriveTaskAgentBadge,
  getBoardTaskPrimaryRunId,
  buildKanbanRefreshKey,
} = await import('../../src/ui/orchestrate-board.ts');
const { closeSubAgentDrawer } = await import('../../src/ui/sub-agent-drawer.ts');
const { setOrchestrateViewMode } = await import('../../src/ui/view-mode-toggle.ts');
const { switchChat, createChatWithMode, createChat } = await import('../../src/ui/sidebar.ts');
const { openBoardGroup } = await import('../../src/state/chat-groups.ts');
const { setStreaming } = await import('../../src/app-state.ts');
const {
  emitMainTurnActivity,
  resetMainTurnActivity,
} = await import('../../src/chat/main-turn-activity.ts');
const { clearBoardListenersForTests } = await import(
  '../../src/state/orchestrate-board-events.ts'
);
const { loadSubAgentConfig, resetSubAgentConfigCache } = await import(
  '../../src/agents/sub-agent-config.ts'
);

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);
  const main = document.createElement('div');
  main.id = 'mainColumn';
  document.body.appendChild(main);

  const modelSelect = document.createElement('select');
  modelSelect.id = 'modelSelect';
  document.body.appendChild(modelSelect);

  const sendBtn = document.createElement('button');
  sendBtn.id = 'sendBtn';
  sendBtn.type = 'button';
  document.body.appendChild(sendBtn);

  const msgInput = document.createElement('textarea');
  msgInput.id = 'msgInput';
  document.body.appendChild(msgInput);
  for (const id of [
    'stripTPS',
    'stripTTFT',
    'stripGen',
    'stripTotal',
    'stripCost',
    'barPrompt',
    'barCompletion',
    'cntPrompt',
    'cntCompletion',
    'msgInput',
    'iArch',
    'iQuant',
    'iCtx',
    'iStop',
  ]) {
    if (!document.getElementById(id)) {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
  }
}

function persistedRun() {
  return {
    runId: FIXED_RUN_ID,
    parentTurnId: 'turn-fixture',
    type: 'builder',
    task: 'Implement task A',
    status: 'completed',
    summary: 'Done.',
    toolTurns: 1,
    messages: [
      { role: 'user', content: 'Do task A' },
      { role: 'assistant', content: 'Finished task A.' },
    ],
  };
}

function makeOrchestrateChat() {
  const chat = createEmptyChatObject('');
  chat.id = FIXED_CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.viewMode = 'board';
  chat.orchestratePlanPath = PLAN_PATH;
  return chat;
}

function makeBoardGroup(chat) {
  return {
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
}

function linkChatToBoardGroup(chat, group) {
  chat.boardGroupId = group.id;
  chat.groupId = group.id;
}

/** Init board on a folder and wire session fields tests expect. */
function initBoardForChat(chat, input) {
  const group = makeBoardGroup(chat);
  initBoard(group, chat, input);
  linkChatToBoardGroup(chat, group);
  return group;
}

function sessionStateForBoard(chat, group, extra = {}) {
  return {
    version: 2,
    activeId: chat.id,
    activeBoardGroupId: group.id,
    sidebarCollapsed: false,
    chats: [chat],
    groups: [group],
    ...extra,
  };
}

/** populateKanbanWaves awaits sub-agent config; prime cache before board paint. */
async function primeSubAgentConfig() {
  resetSubAgentConfigCache();
  await loadSubAgentConfig();
}

async function waitForKanban() {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (document.querySelector('.kanban-grid')) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('kanban grid not rendered');
}

describe('orchestrate board live updates', () => {
  afterEach(() => {
    closeSubAgentDrawer();
    disposeBoardViewForTests();
    clearBoardListenersForTests();
    resetSubAgentConfigCache();
    resetMainTurnActivity();
    setBoardNowForTests(null);
    setSessionStateForTests(null);
  });

  test('empty board view subscribes and paints kanban after board_init', async () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = makeBoardGroup(chat);
    linkChatToBoardGroup(chat, group);
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    assert.ok(document.querySelector('.board-onboarding'));

    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });
    await primeSubAgentConfig();
    refreshActiveBoardIfMounted();
    await waitForKanban();

    assert.ok(
      document.querySelector('.board-main .kanban-grid'),
      'kanban should appear after board_init without switching chats',
    );
    assert.equal(
      document.querySelectorAll('.board-task-card').length,
      1,
    );
  });

  test('updateTask refreshes kanban column without full navigation', async () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    await primeSubAgentConfig();
    renderBoardView(group);
    await waitForKanban();
    const plannedBefore = document.querySelectorAll(
      '.kanban-column:first-child .board-task-card',
    ).length;
    assert.equal(plannedBefore, 2);

    updateTask(group, 'W1-A', { status: 'in_progress' });
    refreshActiveBoardIfMounted();
    await waitForKanban();

    const plannedAfter = document.querySelectorAll(
      '.kanban-column:first-child .board-task-card',
    ).length;
    const inProgress = document.querySelectorAll(
      '.kanban-column:nth-child(2) .board-task-card',
    ).length;
    assert.equal(plannedAfter, 1);
    assert.equal(inProgress, 1);
  });

  test('live refresh preserves manual scroll position of kanban lanes (MIN-259)', async () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'build' },
        { id: 'W1-C', title: 'Task C', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    await primeSubAgentConfig();
    renderBoardView(group);
    await waitForKanban();

    const plannedList = () =>
      document.querySelector('.kanban-column:first-child .kanban-column__list');
    assert.ok(plannedList(), 'planned lane renders');
    // Simulate the user scrolling the lane down.
    plannedList().scrollTop = 120;

    // A live tick re-renders the kanban (status change forces a rebuild).
    updateTask(group, 'W1-A', { error: 'still working' });
    refreshActiveBoardIfMounted();
    await waitForKanban();

    assert.equal(
      plannedList().scrollTop,
      120,
      'manual scroll position is retained across live-tick rebuild',
    );
  });

  test('wave caret collapses kanban and persists on board state', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    await waitForKanban();
    const body = () => document.querySelector('.board-wave-block__body');
    const caret = () => document.querySelector('.board-wave-block__caret');
    assert.ok(body());
    assert.equal(body().hidden, false);
    assert.equal(caret()?.getAttribute('aria-expanded'), 'true');

    caret().click();
    await waitForKanban();
    assert.equal(body().hidden, true);
    assert.equal(chat.orchestrateBoard.waves[0].collapsed, true);
    assert.equal(caret().getAttribute('aria-expanded'), 'false');
    assert.ok(document.querySelector('.board-wave-compact'));
    assert.equal(document.querySelectorAll('.board-wave-compact__chip').length, 1);
    assert.match(
      document.querySelector('.board-wave-compact__title')?.textContent ?? '',
      /Task A/,
    );

    refreshActiveBoardIfMounted();
    await waitForKanban();
    assert.equal(document.querySelector('.board-wave-block__body').hidden, true);
  });

  test('kanban refreshes immediately when a board button stays focused after click', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'complete' });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    await waitForKanban();

    const reopenBtn = document.querySelector(
      '.kanban-column:nth-child(4) .board-task-card__advance-btn',
    );
    assert.ok(reopenBtn, 'complete column shows Reopen');
    reopenBtn.focus();
    assert.equal(document.activeElement, reopenBtn);

    reopenBtn.click();
    await waitForKanban();

    assert.equal(
      document.querySelectorAll('.kanban-column:first-child .board-task-card').length,
      1,
      'reopened task should move to Planned without a second click',
    );
    assert.equal(
      document.querySelectorAll('.kanban-column:nth-child(4) .board-task-card').length,
      0,
    );
  });

  test('header status badge reflects board lifecycle', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    const badge = () =>
      document.querySelector('.board-header__badge .board-header__badge-label');
    assert.equal(badge()?.textContent, 'Ready');

    updateTask(group, 'W1-A', { status: 'in_progress' });
    refreshActiveBoardIfMounted();
    assert.equal(badge()?.textContent, 'Active');

    setStreaming(false);
    refreshActiveBoardIfMounted();
    assert.equal(badge()?.textContent, 'Active');

    updateTask(group, 'W1-A', { status: 'complete' });
    updateTask(group, 'W1-B', { status: 'complete' });
    refreshActiveBoardIfMounted();
    assert.equal(badge()?.textContent, 'Complete');
  });

  test('deriveBoardHeaderStatus marks running when parent turn streams', () => {
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    group.orchestrateBoard.activeParentTurnId = 'turn-abc';
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, true, 0);
    assert.deepEqual(status, { variant: 'running', label: 'Running' });
  });

  test('deriveBoardHeaderStatus marks stopped after user stops orchestrator', () => {
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'in_progress' });
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, false, 0, true);
    assert.deepEqual(status, { variant: 'stopped', label: 'Stopped' });
  });

  test('deriveTaskAgentBadge and canOpenBoardTaskSubAgent follow run linkage', () => {
    assert.equal(
      deriveTaskAgentBadge({
        id: 'W1-A',
        title: 'A',
        wave: 'W1',
        category: 'build',
        status: 'planned',
      }),
      null,
    );
    assert.deepEqual(
      deriveTaskAgentBadge(
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'in_progress',
          assignedRunId: FIXED_RUN_ID,
        },
        'running',
      ),
      { variant: 'active', label: 'Active' },
    );
    assert.deepEqual(
      deriveTaskAgentBadge(
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'failed',
          assignedRunId: FIXED_RUN_ID,
        },
      ),
      { variant: 'failed', label: 'Failed' },
    );
    assert.deepEqual(
      deriveTaskAgentBadge(
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'complete',
          assignedRunId: FIXED_RUN_ID,
        },
        'completed',
      ),
      { variant: 'complete', label: 'Complete' },
    );
    assert.equal(
      canOpenBoardTaskSubAgent({
        id: 'W1-A',
        title: 'A',
        wave: 'W1',
        category: 'build',
        status: 'complete',
        assignedRunId: FIXED_RUN_ID,
      }),
      true,
    );
    assert.deepEqual(
      deriveTaskAgentBadge(
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'complete',
          lastRunId: FIXED_RUN_ID,
          runHistory: [FIXED_RUN_ID],
        },
        'completed',
      ),
      { variant: 'complete', label: 'Complete' },
    );
    assert.equal(
      canOpenBoardTaskSubAgent({
        id: 'W1-A',
        title: 'A',
        wave: 'W1',
        category: 'build',
        status: 'complete',
        lastRunId: FIXED_RUN_ID,
        runHistory: [FIXED_RUN_ID],
      }),
      true,
    );
    assert.equal(getBoardTaskPrimaryRunId({ id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'planned', assignedRunId: 'active-run' }), 'active-run');
    assert.equal(
      getBoardTaskPrimaryRunId({
        id: 'W1-A',
        title: 'A',
        wave: 'W1',
        category: 'build',
        status: 'complete',
        lastRunId: FIXED_RUN_ID,
      }),
      FIXED_RUN_ID,
    );
  });

  test('clicking planned kanban card opens task plan panel', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Task A',
          wave: 'W1',
          category: 'build',
          build: 'Add feature X',
          test: 'npm test',
        },
      ],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    await waitForKanban();

    const plannedCard = document.querySelector(
      '.kanban-column:first-child .board-task-card--clickable',
    );
    assert.ok(plannedCard);
    plannedCard.click();

    const panel = document.querySelector('.board-task-plan-panel:not(.hidden)');
    assert.ok(panel, 'plan panel visible');
    assert.ok(panel.textContent?.includes('Add feature X'));
    assert.ok(panel.textContent?.includes('npm test'));
    assert.equal(document.querySelector('.sub-agent-drawer-panel'), null);
  });

  test('clicking in-progress or complete kanban card switches to chat view', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const taskChat = createEmptyChatObject('');
    taskChat.id = FIXED_TASK_CHAT_ID;
    taskChat.modeId = 'build';
    taskChat.boardTaskId = 'W1-A';
    taskChat.boardGroupId = FIXED_GROUP_ID;
    chat.subAgentRuns = [persistedRun()];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Task A',
          wave: 'W1',
          category: 'build',
          chatId: FIXED_TASK_CHAT_ID,
        },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', {
      status: 'in_progress',
      assignedRunId: FIXED_RUN_ID,
    });
    updateTask(group, 'W1-B', {
      status: 'complete',
      lastRunId: FIXED_RUN_ID,
      runHistory: [FIXED_RUN_ID],
      assignedRunId: null,
    });
    setSessionStateForTests(
      sessionStateForBoard(chat, group, { chats: [chat, taskChat] }),
    );

    renderBoardView(group);
    await waitForKanban();

    const completeBadge = document.querySelector(
      '.kanban-column:nth-child(4) .board-task-card__agent--complete',
    );
    assert.ok(completeBadge, 'complete task shows Complete agent badge');
    completeBadge.closest('.board-task-card--clickable')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(getActiveChat().id, chat.id);

    group.viewMode = 'board';
    setSessionStateForTests(
      sessionStateForBoard(chat, group, { chats: [chat, taskChat] }),
    );
    renderBoardView(group);
    await waitForKanban();

    const inProgressBadge = document.querySelector(
      '.kanban-column:nth-child(2) .board-task-card__agent--active',
    );
    assert.ok(inProgressBadge, 'in-progress task shows Active agent badge');
    const inProgressCard = inProgressBadge.closest('.board-task-card--clickable');
    assert.ok(inProgressCard);
    inProgressCard.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(getActiveChat().id, FIXED_TASK_CHAT_ID);
    assert.equal(document.querySelector('.sub-agent-drawer-panel'), null);
    assert.equal(document.querySelectorAll('.board-agents').length, 0);
  });

  test('settled task with lastRunId shows failed agent badge', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    chat.subAgentRuns = [
      {
        ...persistedRun(),
        status: 'failed',
        summary: 'maximum tool turns reached',
        error: 'maximum tool turns',
        endedAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Failed task', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', {
      status: 'failed',
      lastRunId: FIXED_RUN_ID,
      runHistory: [FIXED_RUN_ID],
      assignedRunId: null,
      endedAt: 1_700_000_100_000,
      error: 'maximum tool turns',
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    await waitForKanban();

    const failedBadge = document.querySelector('.board-task-card__agent--failed');
    assert.ok(failedBadge, 'settled failed task shows Failed agent badge');
    assert.ok(failedBadge.textContent?.includes('Failed'));
  });

  test('board header controls include Plan only (no duplicate chat icon)', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    const toolbar = document.querySelector('.board-header__toolbar');
    const headerControls = document.querySelector('.board-header__controls');
    assert.ok(toolbar?.contains(headerControls));

    const actions = [...headerControls.children].map((el) =>
      el.getAttribute('data-board-action'),
    );
    assert.deepEqual(actions, ['open-plan']);
    assert.equal(document.getElementById('btnViewModeToggleChat'), null);
  });

  test('header badge shows Stopped with danger styling after user stop', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'in_progress' });
    chat.history = [
      { role: 'user', content: 'Run plan' },
      { role: 'assistant', content: 'Partial', stopped: true },
    ];
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    const badge = document.querySelector('.board-header__badge');
    assert.ok(badge?.classList.contains('board-header__badge--stopped'));
    assert.equal(
      badge?.querySelector('.board-header__badge-label')?.textContent,
      'Stopped',
    );
  });

  test('header activity chip is a button when assistant history exists', () => {
    setupDom();
    const chat = makeOrchestrateChat();
    chat.history = [
      { role: 'user', content: 'Run the plan' },
      { role: 'assistant', content: 'Initialized the board and spawned builders.' },
    ];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    const chip = document.querySelector('.board-header__activity');
    assert.ok(chip);
    assert.equal(chip.tagName, 'BUTTON');
    assert.equal(chip.dataset.boardActivityWired, 'true');
  });

  test('setOrchestrateViewMode chat dismisses board (activity chip / header toggle path)', async () => {
    setupDom();
    const chat = makeOrchestrateChat();
    chat.history = [{ role: 'user', content: 'Run the plan' }];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    assert.ok(document.querySelector('.board-root'));

    setOrchestrateViewMode('chat');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(group.viewMode, 'chat');
    assert.equal(document.querySelector('.board-root'), null);
    assert.ok(document.querySelector('.msg.user'));
  });

  test('switchChat to same planner dismisses board DOM', () => {
    setupDom();
    const chat = makeOrchestrateChat();
    chat.history = [{ role: 'user', content: 'Run the plan' }];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    assert.ok(document.querySelector('.board-root'));

    switchChat(chat.id);

    assert.equal(group.viewMode, 'chat');
    assert.equal(document.querySelector('.board-root'), null);
    assert.ok(document.querySelector('.msg.user'));
  });

  test('switchChat to external chat dismisses board and renders target chat', () => {
    setupDom();
    const chat = makeOrchestrateChat();
    const external = createEmptyChatObject('');
    external.id = FIXED_EXTERNAL_CHAT_ID;
    external.modeId = 'general';
    external.history = [{ role: 'user', content: 'Outside folder chat' }];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(
      sessionStateForBoard(chat, group, { chats: [chat, external] }),
    );

    renderBoardView(group);
    assert.ok(document.querySelector('.board-root'));

    switchChat(external.id);

    assert.equal(group.viewMode, 'chat');
    assert.equal(getActiveChat().id, external.id);
    assert.equal(document.querySelector('.board-root'), null);
    assert.ok(document.querySelector('.msg.user'));
    assert.match(
      document.querySelector('.msg.user')?.textContent ?? '',
      /Outside folder chat/,
    );
  });

  test('openBoardGroup from external chat focuses planner before mounting board', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const external = createEmptyChatObject('');
    external.id = FIXED_EXTERNAL_CHAT_ID;
    external.modeId = 'general';
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: external.id,
      sidebarCollapsed: false,
      chats: [chat, external],
      groups: [group],
    });

    openBoardGroup(group.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitForKanban();

    assert.equal(getActiveChat().id, chat.id);
    assert.equal(group.viewMode, 'board');
    assert.ok(document.querySelector('.board-root'));
  });

  test('switchChat to same external chat dismisses board opened from folder header', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const external = createEmptyChatObject('');
    external.id = FIXED_EXTERNAL_CHAT_ID;
    external.modeId = 'general';
    external.history = [{ role: 'user', content: 'Outside folder chat' }];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: external.id,
      sidebarCollapsed: false,
      chats: [chat, external],
      groups: [group],
    });

    openBoardGroup(group.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitForKanban();
    assert.ok(document.querySelector('.board-root'));

    switchChat(external.id);

    assert.equal(group.viewMode, 'chat');
    assert.equal(getActiveChat().id, external.id);
    assert.equal(document.querySelector('.board-root'), null);
    assert.ok(document.querySelector('.msg.user'));
  });

  test('createChatWithMode dismisses board and renders new chat', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    await waitForKanban();
    assert.ok(document.querySelector('.board-root'));

    const created = createChatWithMode({ modeId: 'general' });
    assert.equal(created.ok, true);
    assert.equal(group.viewMode, 'chat');
    assert.equal(getActiveChat().id, created.chatId);
    assert.equal(document.querySelector('.board-root'), null);
    assert.ok(document.getElementById('vibeHub'));
  });

  test('createChat from orchestrate board starts general-mode chat', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    await waitForKanban();
    assert.ok(document.querySelector('.board-root'));

    createChat();

    assert.equal(group.viewMode, 'chat');
    assert.equal(getActiveChat().modeId, 'general');
    assert.notEqual(getActiveChat().id, chat.id);
    assert.equal(document.querySelector('.board-root'), null);
    assert.ok(document.getElementById('vibeHub'));
  });

  test('header activity chip shows last assistant message', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    chat.history = [
      { role: 'user', content: 'Run the plan' },
      {
        role: 'assistant',
        content: 'Initialized the board and spawned builders.',
      },
    ];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests(sessionStateForBoard(chat, group));

    renderBoardView(group);
    const activityText = document.querySelector('.board-header__activity-text');
    assert.ok(activityText);
    assert.match(activityText.textContent ?? '', /Initialized the board/);
    assert.equal(
      document.querySelector('.board-header__activity-kind')?.textContent,
      'Message',
    );
  });

  test('task card shows activity line and related chat row', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    const taskChat = createEmptyChatObject('');
    taskChat.id = FIXED_TASK_CHAT_ID;
    taskChat.name = 'Task W1-A: Task A';
    taskChat.boardGroupId = FIXED_GROUP_ID;
    taskChat.groupId = FIXED_GROUP_ID;
    taskChat.history = [
      { role: 'user', content: 'Start task' },
      { role: 'assistant', content: 'Reading project files.' },
    ];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Task A',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { chatId: FIXED_TASK_CHAT_ID, status: 'in_progress' });
    setSessionStateForTests(
      sessionStateForBoard(chat, group, { chats: [chat, taskChat] }),
    );

    renderBoardView(group);
    await waitForKanban();

    const card = document.querySelector('.board-task-card');
    assert.ok(card?.querySelector('.board-task-card__chat-row'));
    assert.ok(card?.querySelector('.board-task-card__activity'));

    const keyBefore = buildKanbanRefreshKey(group.orchestrateBoard, chat, group);
    emitMainTurnActivity({
      chatId: FIXED_TASK_CHAT_ID,
      phase: 'tools',
      currentTool: 'read_file',
      workAgentLabel: 'Builder',
      modelId: 'm',
      providerId: 'p',
      startedAtMs: 1,
    });
    const keyAfter = buildKanbanRefreshKey(group.orchestrateBoard, chat, group);
    assert.notEqual(keyAfter, keyBefore);
  });

});
