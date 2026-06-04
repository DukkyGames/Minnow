/**
 * Board init split: top Kanban/onboarding + bottom streaming chat during board_init.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { setStreaming } = await import('../../src/app-state.ts');
const { BOARD_ONBOARDING_KICKOFF_MESSAGE } = await import(
  '../../src/ui/orchestrate-board-kickoff.ts'
);
const { appendBubble } = await import('../../src/ui/messages.ts');
const {
  getOrchestrateChatMountElement,
  isOrchestrateBoardInitSplitActive,
  syncOrchestrateInitSplitChrome,
  resetOrchestrateInitSplitForTests,
} = await import('../../src/ui/orchestrate-board-init-split.ts');
const { isStreamDomVisible } = await import('../../src/chat/streaming-state.ts');
const { disposeBoardViewForTests } = await import('../../src/ui/orchestrate-board.ts');

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

/** Mount split panes without async board render (appendBubble tests). */
function mountSplitDomOnly() {
  const area = document.getElementById('chatArea');
  area.replaceChildren();
  const split = document.createElement('div');
  split.className = 'board-init-split';
  const boardPane = document.createElement('div');
  boardPane.className = 'board-init-split__board';
  boardPane.dataset.testid = 'boardInitSplitBoard';
  const chatPane = document.createElement('div');
  chatPane.className = 'board-init-split__chat';
  chatPane.dataset.testid = 'boardInitSplitChat';
  split.appendChild(boardPane);
  split.appendChild(chatPane);
  area.appendChild(split);
  document.getElementById('mainColumn')?.classList.add('main-column--orchestrate-init-split');
}

function seedBoardInitSession({ kickoffInHistory = false } = {}) {
  const chat = createEmptyChatObject('');
  chat.id = FIXED_CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = PLAN_PATH;
  if (kickoffInHistory) {
    chat.history.push({ role: 'user', content: BOARD_ONBOARDING_KICKOFF_MESSAGE });
  }
  const group = {
    id: 'grp-init-split',
    name: 'Orchestrate',
    workspacePath: chat.workspacePath || '',
    collapsed: false,
    order: 0,
    createdAt: 1,
    viewMode: 'board',
    plannerChatId: chat.id,
    orchestratePlanPath: PLAN_PATH,
  };
  chat.boardGroupId = group.id;
  setSessionStateForTests({
    version: 5,
    activeId: chat.id,
    activeBoardGroupId: group.id,
    sidebarCollapsed: false,
    chats: [chat],
    groups: [group],
  });
  return { chat, group };
}

describe('orchestrate board init split', () => {
  afterEach(() => {
    setStreaming(false);
    disposeBoardViewForTests();
    resetOrchestrateInitSplitForTests();
    setSessionStateForTests(null);
  });

  test('split host mounts when init stream starts on empty board', async () => {
    setupDom();
    const { chat } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.ok(document.querySelector('[data-testid="boardInitSplitBoard"]'));
    assert.ok(document.querySelector('[data-testid="boardInitSplitChat"]'));
    assert.ok(
      document.getElementById('mainColumn')?.classList.contains(
        'main-column--orchestrate-init-split',
      ),
    );
    assert.equal(isOrchestrateBoardInitSplitActive(chat), true);
    assert.equal(isStreamDomVisible(chat.id), true);
    disposeBoardViewForTests();
  });

  test('appendBubble targets chat pane during init split', () => {
    setupDom();
    const { chat } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    mountSplitDomOnly();

    appendBubble('user', 'Kickoff echoed in split pane');
    const chatPane = document.querySelector('[data-testid="boardInitSplitChat"]');
    assert.ok(chatPane?.querySelector('.msg.user'));
    assert.equal(
      getOrchestrateChatMountElement().querySelectorAll('.msg').length,
      1,
    );
  });

  test('appendBubble stubs when full board view without split', () => {
    setupDom();
    seedBoardInitSession();
    const chatPaneBefore = document.getElementById('chatArea').childElementCount;
    appendBubble('assistant', 'Hidden');
    assert.equal(document.getElementById('chatArea').childElementCount, chatPaneBefore);
    assert.equal(isStreamDomVisible(FIXED_CHAT_ID), false);
  });

  test('split ends as soon as board exists while stream still runs', async () => {
    setupDom();
    const { chat, group } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(document.querySelector('.board-init-split'));

    group.orchestrateBoard = {
      planPath: PLAN_PATH,
      tasks: [],
      waves: [],
      startedAt: 1,
      lastUpdatedAt: 1,
    };
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));
    disposeBoardViewForTests();

    assert.equal(isOrchestrateBoardInitSplitActive(chat), false);
    assert.equal(document.querySelector('.board-init-split'), null);
    assert.equal(
      document.getElementById('mainColumn')?.classList.contains(
        'main-column--orchestrate-init-split',
      ),
      false,
    );
  });

  test('split tears down after stream end and leaves full board shell', async () => {
    setupDom();
    const { chat } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(document.querySelector('.board-init-split'));

    setStreaming(false, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));
    disposeBoardViewForTests();

    assert.equal(document.querySelector('.board-init-split'), null);
    assert.equal(
      document.getElementById('mainColumn')?.classList.contains(
        'main-column--orchestrate-init-split',
      ),
      false,
    );
    assert.ok(document.querySelector('.board-root'));
  });
});
