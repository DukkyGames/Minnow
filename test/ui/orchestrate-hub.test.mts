import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  listWorkspaceOrchestrateBoardGroups,
  refreshOrchestrateHubPlanPreview,
  resetOrchestrateHubForTests,
} from '../../src/ui/orchestrate-hub.ts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { getOrCreateBoardGroup } from '../../src/state/chat-groups.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

const WORKSPACE = '/tmp/orchestrate-hub-test';

/** happy-dom Window + globals required by hub mount (Super Plan chrome teardown). */
function mountHubDom(): { area: HTMLElement; btn: HTMLButtonElement } {
  const win = new Window();
  globalThis.window = win as unknown as Window & typeof globalThis;
  globalThis.document = win.document;
  globalThis.HTMLElement = win.HTMLElement;
  (globalThis as Record<string, unknown>).HTMLSelectElement = win.HTMLSelectElement;
  (globalThis as Record<string, unknown>).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as Record<string, unknown>).HTMLInputElement = win.HTMLInputElement;
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const area = document.createElement('main');
  area.id = 'chatArea';
  document.body.appendChild(area);

  const btn = document.createElement('button');
  btn.id = 'btnOrchestrate';
  document.body.appendChild(btn);
  return { area, btn };
}

describe('listWorkspaceOrchestrateBoardGroups', () => {
  afterEach(() => {
    resetOrchestrateHubForTests();
    setSessionStateForTests(null);
  });

  test('includes groups with boards and orchestrate plan paths', () => {
    const withBoardPlanner = createEmptyChatObject('m1');
    withBoardPlanner.workspacePath = WORKSPACE;
    withBoardPlanner.modeId = 'orchestrate';

    const withPlanPlanner = createEmptyChatObject('m1');
    withPlanPlanner.workspacePath = WORKSPACE;
    withPlanPlanner.modeId = 'orchestrate';
    withPlanPlanner.orchestratePlanPath = 'documentation/plans/b.md';

    const buildOnly = createEmptyChatObject('m1');
    buildOnly.workspacePath = WORKSPACE;
    buildOnly.modeId = 'build';

    setSessionStateForTests({
      version: 5,
      activeId: withBoardPlanner.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [withBoardPlanner, withPlanPlanner, buildOnly],
    });

    const boardGroup = getOrCreateBoardGroup(withBoardPlanner);
    initBoard(boardGroup, withBoardPlanner, {
      planPath: 'documentation/plans/a.md',
      tasks: [{ id: 't1', title: 'One', wave: 1, category: 'code', status: 'planned' }],
      waves: [{ id: 'W1' }],
    });
    getOrCreateBoardGroup(withPlanPlanner);

    const listed = listWorkspaceOrchestrateBoardGroups(WORKSPACE);
    assert.equal(listed.length, 2);
    assert.ok(listed.some((g) => g.id === boardGroup.id));
    assert.ok(listed.some((g) => g.orchestratePlanPath === 'documentation/plans/b.md'));
  });
});

describe('orchestrate hub mount', () => {
  afterEach(() => {
    resetOrchestrateHubForTests();
    setSessionStateForTests(null);
  });

  test('toggle renders hub root in chat area', async () => {
    const { area, btn } = mountHubDom();

    const chat = createEmptyChatObject('m1');
    setSessionStateForTests({
      version: 4,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const hub = await import('../../src/ui/orchestrate-hub.ts');
    hub.renderOrchestrateHub();
    assert.ok(document.getElementById('orchestrateHub'));
    const previewSection = document.getElementById('orchestrateHubPlanPreview');
    assert.ok(previewSection, 'plan preview panel should exist');
    assert.equal(previewSection?.hidden, true, 'preview hidden until a plan is selected');
    const makePlanBtn = document.querySelector('.orchestrate-hub__make-plan-btn');
    assert.ok(makePlanBtn, 'Make a plan button should exist');
    assert.equal(makePlanBtn?.textContent, 'Make a plan');
    const heading = document.querySelector('.orchestrate-hub__title');
    assert.equal(heading?.textContent, 'Boards & plans');
    const boardList = document.querySelector('.orchestrate-hub__board-list');
    assert.ok(boardList, 'board list container should exist');
    assert.equal(boardList?.getAttribute('role'), 'list');
    assert.ok(area.classList.contains('chat-area--orchestrate-hub'));
    assert.ok(document.querySelector('.ob-page'), 'ob-page shell should mount');
    assert.ok(document.querySelector('.ob-rail'), 'board library rail should mount');
    assert.ok(document.querySelector('.ob-pane--ask'), 'ask pane should mount');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');

    hub.toggleOrchestrateHubFromTopbar();
    assert.equal(document.getElementById('orchestrateHub'), null);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
  });

  test('refreshOrchestrateHubPlanList re-populates the plan dropdown (MIN-215)', async () => {
    mountHubDom();

    const chat = createEmptyChatObject('m1');
    setSessionStateForTests({
      version: 4,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const hub = await import('../../src/ui/orchestrate-hub.ts');
    hub.renderOrchestrateHub();
    const flush = async () => {
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
    };
    // Let the initial (server-off) plan load settle before mutating the select.
    await flush();

    const sel = document.getElementById('orchestrateHubPlanSelect') as HTMLSelectElement;
    assert.ok(sel, 'plan select exists');

    // Simulate a stale dropdown entry that a fresh load must clear.
    const stale = document.createElement('option');
    stale.value = 'documentation/plans/stale.md';
    sel.appendChild(stale);
    assert.ok(
      [...sel.options].some((o) => o.value === 'documentation/plans/stale.md'),
      'stale option present before refresh',
    );

    await hub.refreshOrchestrateHubPlanList();

    assert.ok(
      ![...sel.options].some((o) => o.value === 'documentation/plans/stale.md'),
      'stale option cleared after plan-list refresh',
    );

    // No-op (and no throw) once the hub is torn down.
    hub.toggleOrchestrateHubFromTopbar();
    await hub.refreshOrchestrateHubPlanList();
  });

  test('board live refresh does not replace an open orchestrate hub', async () => {
    const { area } = mountHubDom();

    const chat = createEmptyChatObject('m1');
    chat.modeId = 'orchestrate';
    chat.viewMode = 'board';
    chat.orchestrateBoard = {
      planPath: 'documentation/plans/a.md',
      startedAt: 1000,
      lastUpdatedAt: 2000,
      waves: [],
      tasks: [],
    };

    setSessionStateForTests({
      version: 4,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const hub = await import('../../src/ui/orchestrate-hub.ts');
    hub.renderOrchestrateHub();
    assert.ok(document.getElementById('orchestrateHub'));

    const board = await import('../../src/ui/orchestrate-board.ts');
    board.refreshActiveBoardIfMounted();
    assert.ok(
      document.getElementById('orchestrateHub'),
      'hub should stay mounted while board refresh runs',
    );
    assert.equal(area.querySelector('.board-root'), null);
  });

  test('refreshOrchestrateHubPlanPreview hides panel for empty selection', async () => {
    const win = new Window();
    globalThis.document = win.document;
    globalThis.HTMLElement = win.HTMLElement;

    const section = document.createElement('div');
    section.id = 'orchestrateHubPlanPreview';
    const pathChip = document.createElement('p');
    const previewMount = document.createElement('div');
    previewMount.id = 'orchestrateHubPlanPreviewMount';
    section.append(pathChip, previewMount);

    await refreshOrchestrateHubPlanPreview('', {
      section,
      pathChip,
      previewMount,
    });
    assert.equal(section.hidden, true);
    assert.equal(previewMount.childElementCount, 0);
  });
});
