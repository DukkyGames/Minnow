import assert from 'node:assert/strict';

import { afterEach, describe, test } from 'node:test';

import { Window } from 'happy-dom';



const { setSessionStateForTests, createEmptyChatObject } = await import(

  '../../src/state/sessions.ts'

);

const appState = await import('../../src/app-state.ts');

const {

  appendBoardChatViewToggle,

  initViewModeToggle,

  isBoardViewActive,

  resetViewModeToggleForTests,

  setViewModeToggleRenderHandlerForTests,

  syncViewModeToggleFromActiveChat,

} = await import('../../src/ui/view-mode-toggle.ts');

const { renderBoardView, disposeBoardViewForTests } = await import(
  '../../src/ui/orchestrate-board.ts'
);



const PLAN_PATH = 'documentation/plans/shiny-minsky-board-view.md';

const MIN_BOARD = {
  planPath: PLAN_PATH,
  tasks: [
    {
      id: 'W1-A',
      title: 'Fixture task',
      wave: 'W1',
      category: 'build',
      status: 'planned',
    },
  ],
  waves: [{ id: 'W1', status: 'planned', taskCount: 1, completeCount: 0 }],
  startedAt: 1710000001000,
  lastUpdatedAt: 1710000001000,
};



function setupDom() {

  const window = new Window();

  globalThis.document = window.document;

  globalThis.HTMLElement = window.HTMLElement;

  globalThis.Node = window.Node;



  const boardBtn = document.createElement('button');

  boardBtn.type = 'button';

  boardBtn.id = 'btnViewModeToggleBoard';

  boardBtn.className = 'icon-btn view-mode-toggle-btn view-mode-toggle-btn--to-board';

  boardBtn.setAttribute('aria-label', 'Board view');

  boardBtn.disabled = true;

  boardBtn.hidden = true;

  boardBtn.classList.add('hidden');

  document.body.appendChild(boardBtn);



  const area = document.createElement('div');

  area.id = 'chatArea';

  document.body.appendChild(area);



  const mainColumn = document.createElement('div');

  mainColumn.id = 'mainColumn';

  mainColumn.className = 'main-column';

  document.body.appendChild(mainColumn);



  return window;

}



function mountChatToggle() {

  const controls = document.createElement('div');

  controls.className = 'board-header__controls';

  document.body.appendChild(controls);

  appendBoardChatViewToggle(controls);

  return document.getElementById('btnViewModeToggleChat');

}



function seedSession(overrides = {}) {

  const chat = createEmptyChatObject('');

  chat.id = 'chat-view-mode-1';

  Object.assign(chat, overrides);

  setSessionStateForTests({

    version: 2,

    activeId: chat.id,

    sidebarCollapsed: false,

    chats: [chat],

  });

  return chat;

}



describe('view-mode toggle', { concurrency: false }, () => {

  afterEach(() => {

    appState.setStreaming(false);

    disposeBoardViewForTests();

    setSessionStateForTests(null);

    resetViewModeToggleForTests();

    setViewModeToggleRenderHandlerForTests(null);

  });



  test('board toggle hidden and disabled when not orchestrate', () => {

    setupDom();

    seedSession({ modeId: 'build' });

    initViewModeToggle();

    syncViewModeToggleFromActiveChat();



    const btn = document.getElementById('btnViewModeToggleBoard');

    assert.ok(btn);

    assert.equal(btn.disabled, true);

    assert.equal(btn.hidden, true);

    assert.ok(btn.classList.contains('hidden'));

  });



  test('board toggle enabled in orchestrate chat view without plan path', () => {

    setupDom();

    seedSession({ modeId: 'orchestrate' });

    initViewModeToggle();

    syncViewModeToggleFromActiveChat();



    const btn = document.getElementById('btnViewModeToggleBoard');

    assert.ok(btn);

    assert.equal(btn.disabled, false);

    assert.equal(btn.hidden, false);

    assert.ok(!btn.classList.contains('hidden'));

    assert.equal(btn.title, 'Board view (select a plan in chat view for full board)');

  });



  test('board toggle enabled when orchestrate + plan path', () => {

    setupDom();

    seedSession({

      modeId: 'orchestrate',

      orchestratePlanPath: PLAN_PATH,

    });

    initViewModeToggle();

    syncViewModeToggleFromActiveChat();



    const btn = document.getElementById('btnViewModeToggleBoard');

    assert.ok(btn);

    assert.equal(btn.disabled, false);

    assert.equal(btn.getAttribute('aria-label'), 'Switch to board view');

  });



  test('chat toggle can leave board view when orchestrate has no plan', () => {

    setupDom();

    const grpId = 'grp-no-plan';

    const chat = createEmptyChatObject('');

    chat.id = 'chat-view-mode-1';

    chat.modeId = 'orchestrate';

    chat.boardGroupId = grpId;

    const group = {

      id: grpId, name: 'Board', workspacePath: '', collapsed: false,

      order: 0, createdAt: 1, plannerChatId: chat.id, viewMode: 'board',

    };

    setSessionStateForTests({

      version: 5, activeId: chat.id, sidebarCollapsed: false,

      chats: [chat], groups: [group], activeBoardGroupId: grpId,

    });

    initViewModeToggle();

    const chatBtn = mountChatToggle();

    syncViewModeToggleFromActiveChat();



    assert.ok(chatBtn);

    assert.equal(chatBtn.disabled, false);

    assert.equal(chatBtn.getAttribute('aria-label'), 'Switch to chat view');



    chatBtn.click();

    assert.equal(isBoardViewActive(), false);

  });



  test('board toggle stays enabled while active chat is streaming', () => {

    setupDom();

    const chat = seedSession({

      modeId: 'orchestrate',

      orchestratePlanPath: PLAN_PATH,

    });

    appState.setStreaming(true, chat.id);

    initViewModeToggle();

    syncViewModeToggleFromActiveChat();



    const btn = document.getElementById('btnViewModeToggleBoard');

    assert.ok(btn);

    assert.equal(btn.disabled, false);

  });



  test('board toggle click switches to board view and calls render path', () => {

    setupDom();

    const chat = seedSession({

      modeId: 'orchestrate',

      orchestratePlanPath: PLAN_PATH,

      viewMode: 'chat',

    });

    initViewModeToggle();

    syncViewModeToggleFromActiveChat();



    let renderCalls = 0;

    let renderedChat = null;

    setViewModeToggleRenderHandlerForTests((c) => {

      renderCalls += 1;

      renderedChat = c;

    });



    const btn = document.getElementById('btnViewModeToggleBoard');

    assert.ok(btn);

    btn.click();



    assert.equal(isBoardViewActive(), true);

    assert.equal(renderCalls, 1);

    assert.equal(renderedChat?.id, chat.id);

    assert.equal(btn.hidden, true);



    const mainColumn = document.getElementById('mainColumn');

    assert.ok(mainColumn?.classList.contains('main-column--board-view'));

  });



  test('chat toggle works after switching from chat bubbles to board view', () => {
    setupDom();

    const grpId = 'grp-board-render';

    const chat = createEmptyChatObject('');

    chat.id = 'chat-view-mode-1';

    chat.modeId = 'orchestrate';

    chat.orchestratePlanPath = PLAN_PATH;

    chat.boardGroupId = grpId;

    const group = {

      id: grpId, name: 'Board', workspacePath: '', collapsed: false,

      order: 0, createdAt: 1, plannerChatId: chat.id,

      orchestratePlanPath: PLAN_PATH, viewMode: 'board',

      orchestrateBoard: MIN_BOARD,

    };

    setSessionStateForTests({

      version: 5, activeId: chat.id, sidebarCollapsed: false,

      chats: [chat], groups: [group], activeBoardGroupId: grpId,

    });

    const area = document.getElementById('chatArea');

    const bubble = document.createElement('div');

    bubble.className = 'msg user';

    area.appendChild(bubble);

    setViewModeToggleRenderHandlerForTests(() => {});

    initViewModeToggle();

    renderBoardView(group);

    assert.equal(area.querySelector('.msg'), null, 'chat bubbles cleared on board mount');

    // Chat toggle is not auto-mounted by renderBoardView; wire it manually to test its handler
    const chatBtn = mountChatToggle();

    assert.ok(chatBtn, 'chat toggle mounted in board header controls');

    chatBtn.click();

    assert.equal(isBoardViewActive(), false);

  });

  test('chat view removes board chrome class', () => {

    setupDom();

    const chat = seedSession({

      modeId: 'orchestrate',

      orchestratePlanPath: PLAN_PATH,

      viewMode: 'board',

    });

    initViewModeToggle();

    syncViewModeToggleFromActiveChat();



    chat.viewMode = 'chat';

    syncViewModeToggleFromActiveChat();



    const mainColumn = document.getElementById('mainColumn');

    assert.equal(mainColumn?.classList.contains('main-column--board-view'), false);

    const boardBtn = document.getElementById('btnViewModeToggleBoard');

    assert.equal(boardBtn?.hidden, false);

  });

});


