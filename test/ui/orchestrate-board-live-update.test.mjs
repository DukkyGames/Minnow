/**
 * Board view live updates: subscriptions on empty board + in-place kanban refresh.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_RUN_ID = '22222222-2222-2222-2222-222222222222';
const FIXED_TASK_CHAT_ID = '33333333-3333-3333-3333-333333333333';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
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
const { setViewModeToggleRenderHandlerForTests } = await import(
  '../../src/ui/view-mode-toggle.ts'
);
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
  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);
  const main = document.createElement('div');
  main.id = 'mainColumn';
  document.body.appendChild(main);
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

  test('empty board view subscribes and paints kanban after board_init', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
    assert.ok(document.querySelector('.board-onboarding'));

    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });

    assert.ok(
      document.querySelector('.board-main .kanban-grid'),
      'kanban should appear after board_init without switching chats',
    );
    assert.equal(
      document.querySelectorAll('.board-task-card').length,
      1,
    );
  });

  test('updateTask refreshes kanban column without full navigation', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
    const plannedBefore = document.querySelectorAll(
      '.kanban-column:first-child .board-task-card',
    ).length;
    assert.equal(plannedBefore, 2);

    updateTask(chat, 'W1-A', { status: 'in_progress' });

    const plannedAfter = document.querySelectorAll(
      '.kanban-column:first-child .board-task-card',
    ).length;
    const inProgress = document.querySelectorAll(
      '.kanban-column:nth-child(2) .board-task-card',
    ).length;
    assert.equal(plannedAfter, 1);
    assert.equal(inProgress, 1);
  });

  test('wave caret collapses kanban and persists on board state', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
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
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'complete' });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
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
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
    const badge = () =>
      document.querySelector('.board-header__badge .board-header__badge-label');
    assert.equal(badge()?.textContent, 'Ready');

    updateTask(chat, 'W1-A', { status: 'in_progress' });
    refreshActiveBoardIfMounted();
    assert.equal(badge()?.textContent, 'Active');

    setStreaming(false);
    refreshActiveBoardIfMounted();
    assert.equal(badge()?.textContent, 'Active');

    updateTask(chat, 'W1-A', { status: 'complete' });
    updateTask(chat, 'W1-B', { status: 'complete' });
    refreshActiveBoardIfMounted();
    assert.equal(badge()?.textContent, 'Complete');
  });

  test('deriveBoardHeaderStatus marks running when parent turn streams', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    chat.orchestrateBoard.activeParentTurnId = 'turn-abc';
    const status = deriveBoardHeaderStatus(chat.orchestrateBoard, true, 0);
    assert.deepEqual(status, { variant: 'running', label: 'Running' });
  });

  test('deriveBoardHeaderStatus marks stopped after user stops orchestrator', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'in_progress' });
    const status = deriveBoardHeaderStatus(chat.orchestrateBoard, false, 0, true);
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

  test('clicking in-progress or complete kanban card opens sub-agent drawer', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    chat.subAgentRuns = [persistedRun()];
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', {
      status: 'in_progress',
      assignedRunId: FIXED_RUN_ID,
    });
    updateTask(chat, 'W1-B', {
      status: 'complete',
      lastRunId: FIXED_RUN_ID,
      runHistory: [FIXED_RUN_ID],
      assignedRunId: null,
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);

    const inProgressBadge = document.querySelector(
      '.kanban-column:nth-child(2) .board-task-card__agent--active',
    );
    assert.ok(inProgressBadge, 'in-progress task shows Active agent badge');
    const inProgressCard = inProgressBadge.closest('.board-task-card--clickable');
    assert.ok(inProgressCard);
    inProgressCard.click();
    assert.ok(document.querySelector('.sub-agent-drawer-panel'));
    closeSubAgentDrawer();

    const completeBadge = document.querySelector(
      '.kanban-column:nth-child(4) .board-task-card__agent--complete',
    );
    assert.ok(completeBadge, 'complete task shows Complete agent badge');
    completeBadge.closest('.board-task-card--clickable')?.click();
    assert.ok(document.querySelector('.sub-agent-drawer-panel'));
    assert.equal(document.querySelectorAll('.board-agents').length, 0);
  });

  test('settled task with lastRunId opens drawer after assignedRunId cleared', () => {
    setupDom();
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
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Failed task', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', {
      status: 'failed',
      lastRunId: FIXED_RUN_ID,
      runHistory: [FIXED_RUN_ID],
      assignedRunId: null,
      endedAt: 1_700_000_100_000,
      error: 'maximum tool turns',
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);

    const failedBadge = document.querySelector('.board-task-card__agent--failed');
    assert.ok(failedBadge, 'settled failed task shows Failed agent badge');
    assert.ok(failedBadge.textContent?.includes('Failed'));
  });

  test('board header controls include Plan and Chat view', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
    const toolbar = document.querySelector('.board-header__toolbar');
    const headerControls = document.querySelector('.board-header__controls');
    assert.ok(toolbar?.contains(headerControls));

    const actions = [...headerControls.children].map(
      (el) =>
        el.getAttribute('data-board-action') ??
        (el.id === 'btnViewModeToggleChat' ? 'chat-view' : null),
    );
    assert.deepEqual(actions, ['open-plan', 'chat-view']);
  });

  test('header badge shows Stopped with danger styling after user stop', () => {
    setupDom();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'Task B', wave: 'W1', category: 'test' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'in_progress' });
    chat.history = [
      { role: 'user', content: 'Run plan' },
      { role: 'assistant', content: 'Partial', stopped: true },
    ];
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
    const badge = document.querySelector('.board-header__badge');
    assert.ok(badge?.classList.contains('board-header__badge--stopped'));
    assert.equal(
      badge?.querySelector('.board-header__badge-label')?.textContent,
      'Stopped',
    );
  });

  test('header activity chip opens chat view on click', () => {
    setupDom();
    const chat = makeOrchestrateChat();
    chat.history = [
      { role: 'user', content: 'Run the plan' },
      {
        role: 'assistant',
        content: 'Initialized the board and spawned builders.',
      },
    ];
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    let renderCalls = 0;
    setViewModeToggleRenderHandlerForTests(() => {
      renderCalls += 1;
    });

    renderBoardView(chat);
    const chip = document.querySelector('.board-header__activity');
    assert.ok(chip);
    assert.equal(chip.tagName, 'BUTTON');
    chip.click();
    assert.equal(chat.viewMode, 'chat');
    assert.equal(renderCalls, 1);

    setViewModeToggleRenderHandlerForTests(null);
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
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
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
    taskChat.groupId = chat.boardGroupId ?? chat.id;
    taskChat.history = [
      { role: 'user', content: 'Start task' },
      { role: 'assistant', content: 'Reading project files.' },
    ];
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        {
          id: 'W1-A',
          title: 'Task A',
          wave: 'W1',
          category: 'build',
          agentType: 'builder',
        },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { chatId: FIXED_TASK_CHAT_ID, status: 'in_progress' });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat, taskChat],
    });

    renderBoardView(chat);
    await waitForKanban();

    const card = document.querySelector('.board-task-card');
    assert.ok(card?.querySelector('.board-task-card__chat-row'));
    assert.ok(card?.querySelector('.board-task-card__activity'));

    const keyBefore = buildKanbanRefreshKey(chat.orchestrateBoard, chat);
    emitMainTurnActivity({
      chatId: FIXED_TASK_CHAT_ID,
      phase: 'tools',
      currentTool: 'read_file',
      workAgentLabel: 'Builder',
      modelId: 'm',
      providerId: 'p',
      startedAtMs: 1,
    });
    const keyAfter = buildKanbanRefreshKey(chat.orchestrateBoard, chat);
    assert.notEqual(keyAfter, keyBefore);
  });

  test('focused agent select is not replaced by in-place board refresh', async () => {
    setupDom();
    await primeSubAgentConfig();
    setBoardNowForTests(() => 1_700_000_000_000);
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderBoardView(chat);
    await waitForKanban();

    const select = document.querySelector('.board-task-card__agent-select');
    assert.ok(select instanceof HTMLSelectElement);
    const keyBefore = buildKanbanRefreshKey(chat.orchestrateBoard, chat);
    select.focus();
    refreshActiveBoardIfMounted();
    const keyAfter = buildKanbanRefreshKey(chat.orchestrateBoard, chat);
    assert.equal(keyAfter, keyBefore);
    const selectAfter = document.querySelector('.board-task-card__agent-select');
    assert.equal(selectAfter, select, 'timer refresh must not rebuild kanban while select is focused');
  });
});
