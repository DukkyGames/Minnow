/**
 * Board-only streaming: appendBubble does not mutate #chatArea in full board view.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { setStreaming } = await import('../../src/app-state.ts');
const { BOARD_ONBOARDING_KICKOFF_MESSAGE } = await import(
  '../../src/ui/orchestrate-board-kickoff.ts'
);
const { appendBubble } = await import('../../src/ui/messages.ts');
const { resetOrchestrateInitSplitForTests } = await import(
  '../../src/ui/orchestrate-board-init-split.ts'
);
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

function seedBoardViewSession({ kickoffInHistory = false } = {}) {
  const chat = createEmptyChatObject('');
  chat.id = FIXED_CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = 'documentation/plans/x.md';
  if (kickoffInHistory) {
    chat.history.push({ role: 'user', content: BOARD_ONBOARDING_KICKOFF_MESSAGE });
  }
  const group = {
    id: 'grp-stream-guard',
    name: 'Board',
    workspacePath: chat.workspacePath || '',
    collapsed: false,
    order: 0,
    createdAt: 1,
    viewMode: 'board',
    plannerChatId: chat.id,
    orchestratePlanPath: chat.orchestratePlanPath,
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
  return chat;
}

describe('orchestrate board streaming guards', () => {
  afterEach(() => {
    setStreaming(false);
    disposeBoardViewForTests();
    resetOrchestrateInitSplitForTests();
    setSessionStateForTests(null);
  });

  test('appendBubble does not append to chatArea when full board view without split', () => {
    setupDom();
    seedBoardViewSession();
    const before = document.getElementById('chatArea').childElementCount;
    appendBubble('assistant', 'Hello from stream');
    const after = document.getElementById('chatArea').childElementCount;
    assert.equal(after, before);
  });

  test('appendBubble does not append build task stream during full board view', () => {
    setupDom();
    const planner = createEmptyChatObject('');
    planner.id = '22222222-2222-2222-2222-222222222222';
    planner.modeId = 'orchestrate';
    planner.orchestratePlanPath = 'documentation/plans/x.md';
    const task = createEmptyChatObject('');
    task.id = '33333333-3333-3333-3333-333333333333';
    task.modeId = 'build';
    task.boardGroupId = 'grp-build-stream-guard';
    const group = {
      id: 'grp-build-stream-guard',
      name: 'Board',
      workspacePath: planner.workspacePath || '',
      collapsed: false,
      order: 0,
      createdAt: 1,
      viewMode: 'board',
      plannerChatId: planner.id,
      orchestratePlanPath: planner.orchestratePlanPath,
      orchestrateBoard: { planPath: planner.orchestratePlanPath, tasks: [], waves: [] },
    };
    planner.boardGroupId = group.id;
    setSessionStateForTests({
      version: 5,
      activeId: task.id,
      activeBoardGroupId: group.id,
      sidebarCollapsed: false,
      chats: [planner, task],
      groups: [group],
    });
    setStreaming(true, task.id);
    const before = document.getElementById('chatArea').childElementCount;
    appendBubble('assistant', 'Task stream prose');
    const after = document.getElementById('chatArea').childElementCount;
    assert.equal(after, before);
  });

  test('appendBubble appends to split chat pane during board init stream', () => {
    setupDom();
    const chat = seedBoardViewSession({ kickoffInHistory: true });
    setStreaming(true, chat.id);
    mountSplitDomOnly();

    appendBubble('user', 'board_init running');
    const chatPane = document.querySelector('[data-testid="boardInitSplitChat"]');
    assert.ok(chatPane?.querySelector('.msg.user'));
  });
});
