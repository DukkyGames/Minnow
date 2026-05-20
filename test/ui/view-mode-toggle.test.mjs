import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const {
  initViewModeToggle,
  resetViewModeToggleForTests,
  setViewModeToggleRenderHandlerForTests,
  syncViewModeToggleFromActiveChat,
} = await import('../../src/ui/view-mode-toggle.ts');

const PLAN_PATH = 'documentation/plans/shiny-minsky-board-view.md';

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btnViewModeToggle';
  btn.className = 'icon-btn view-mode-toggle-btn';
  btn.setAttribute('aria-label', 'Board view');
  btn.setAttribute('aria-pressed', 'false');
  btn.disabled = true;
  document.body.appendChild(btn);

  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);

  const mainColumn = document.createElement('div');
  mainColumn.id = 'mainColumn';
  mainColumn.className = 'main-column';
  document.body.appendChild(mainColumn);

  return window;
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
    setSessionStateForTests(null);
    resetViewModeToggleForTests();
    setViewModeToggleRenderHandlerForTests(null);
  });

  test('toggle disabled when not orchestrate', () => {
    setupDom();
    seedSession({ modeId: 'build' });
    initViewModeToggle();
    syncViewModeToggleFromActiveChat();

    const btn = document.getElementById('btnViewModeToggle');
    assert.ok(btn);
    assert.equal(btn.disabled, true);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
  });

  test('toggle enabled when orchestrate + plan path', () => {
    setupDom();
    seedSession({
      modeId: 'orchestrate',
      orchestratePlanPath: PLAN_PATH,
    });
    initViewModeToggle();
    syncViewModeToggleFromActiveChat();

    const btn = document.getElementById('btnViewModeToggle');
    assert.ok(btn);
    assert.equal(btn.disabled, false);
    assert.equal(btn.getAttribute('aria-label'), 'Switch to board view');
  });

  test('click toggles to board view and calls render path', () => {
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

    const btn = document.getElementById('btnViewModeToggle');
    assert.ok(btn);
    btn.click();

    assert.equal(chat.viewMode, 'board');
    assert.equal(renderCalls, 1);
    assert.equal(renderedChat?.id, chat.id);
    assert.equal(renderedChat?.viewMode, 'board');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');

    const mainColumn = document.getElementById('mainColumn');
    assert.ok(mainColumn?.classList.contains('main-column--board-view'));
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
    const btn = document.getElementById('btnViewModeToggle');
    assert.equal(btn?.getAttribute('aria-pressed'), 'false');
  });
});
