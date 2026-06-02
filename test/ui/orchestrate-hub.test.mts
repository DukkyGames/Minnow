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
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = document.createElement('main');
    area.id = 'chatArea';
    document.body.appendChild(area);

    const btn = document.createElement('button');
    btn.id = 'btnOrchestrate';
    document.body.appendChild(btn);

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
    assert.equal(btn.getAttribute('aria-pressed'), 'true');

    hub.toggleOrchestrateHubFromTopbar();
    assert.equal(document.getElementById('orchestrateHub'), null);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
  });

  test('board live refresh does not replace an open orchestrate hub', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = document.createElement('main');
    area.id = 'chatArea';
    document.body.appendChild(area);

    document.body.appendChild(
      Object.assign(document.createElement('button'), { id: 'btnOrchestrate' }),
    );

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
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

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
