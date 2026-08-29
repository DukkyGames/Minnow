/**
 * Board init: full-screen onboarding loader during board_init (no chat split).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';

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
  isOrchestrateInitSplitChromeActive,
  syncOrchestrateInitSplitChrome,
  resetOrchestrateInitSplitForTests,
} = await import('../../src/ui/orchestrate-board-init-split.ts');
const { isStreamDomVisible } = await import('../../src/chat/streaming-state.ts');
const { disposeBoardViewForTests } = await import('../../src/ui/orchestrate-board.ts');

function setupDom() {
  const window = new Window();
  installHappyDomGlobals(window);
  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);
  const main = document.createElement('div');
  main.id = 'mainColumn';
  document.body.appendChild(main);
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

describe('orchestrate board init loader', () => {
  afterEach(() => {
    setStreaming(false);
    disposeBoardViewForTests();
    resetOrchestrateInitSplitForTests();
    setSessionStateForTests(null);
  });

  test('init stream does not mount legacy chat split', async () => {
    setupDom();
    const { chat } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(document.querySelector('[data-testid="boardInitSplitChat"]'), null);
    assert.equal(document.querySelector('.board-init-split'), null);
    assert.equal(isOrchestrateInitSplitChromeActive(), false);
    assert.equal(isOrchestrateBoardInitSplitActive(chat), true);
    assert.equal(isStreamDomVisible(chat.id), false);
    disposeBoardViewForTests();
  });

  test('init stream still activates when kickoff names the bound plan path', async () => {
    setupDom();
    const { chat } = seedBoardInitSession();
    const { buildBoardOnboardingKickoffMessage } = await import(
      '../../src/ui/orchestrate-board-kickoff.ts'
    );
    chat.history.push({
      role: 'user',
      content: buildBoardOnboardingKickoffMessage(PLAN_PATH),
    });
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(isOrchestrateBoardInitSplitActive(chat), true);
    disposeBoardViewForTests();
  });

  test('appendBubble stays hidden during board init without split', () => {
    setupDom();
    const { chat } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);

    appendBubble('user', 'Kickoff echoed in split pane');
    assert.equal(document.getElementById('chatArea').querySelectorAll('.msg').length, 0);
    assert.equal(
      getOrchestrateChatMountElement().querySelectorAll('.msg').length,
      0,
    );
    assert.equal(isStreamDomVisible(FIXED_CHAT_ID), false);
  });

  test('init ends when board exists while stream still runs', async () => {
    setupDom();
    const { chat, group } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));

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
    assert.ok(document.querySelector('.board-root'));
  });

  test('stream end leaves full board shell', async () => {
    setupDom();
    const { chat } = seedBoardInitSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));

    setStreaming(false, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    await new Promise((resolve) => setTimeout(resolve, 30));
    disposeBoardViewForTests();

    assert.equal(document.querySelector('.board-init-split'), null);
    assert.ok(document.querySelector('.board-root'));
  });
});
