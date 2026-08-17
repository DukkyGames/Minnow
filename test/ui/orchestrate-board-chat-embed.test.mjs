/**
 * Board task chat embed: bubbles and stream rows paint into `.ob-chat__transcript`
 * while the board view stays active.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const PLANNER_ID = '22222222-2222-2222-2222-222222222222';
const TASK_CHAT_ID = '33333333-3333-3333-3333-333333333333';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { setStreaming } = await import('../../src/app-state.ts');
const { appendBubble, appendStreamingAssistantRow } = await import(
  '../../src/ui/messages.ts'
);
const { disposeBoardViewForTests, refreshActiveBoardIfMounted } = await import(
  '../../src/ui/orchestrate-board.ts'
);
const { ensureBoardChatComposerChrome } = await import(
  '../../src/ui/orchestrate-board-chat.ts'
);
const { resetOrchestrateInitSplitForTests } = await import(
  '../../src/ui/orchestrate-board-init-split.ts'
);
const {
  setOpenBoardChatId,
  ORCHESTRATE_CHAT_PANE_TESTID,
} = await import('../../src/ui/orchestrate-board-chat-state.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => window.requestAnimationFrame(cb);
  globalThis.cancelAnimationFrame = (id) => window.cancelAnimationFrame(id);

  const area = document.createElement('div');
  area.id = 'chatArea';
  area.classList.add('chat-area--orchestrate');
  document.body.appendChild(area);

  const main = document.createElement('div');
  main.id = 'mainColumn';
  document.body.appendChild(main);

  const obChat = document.createElement('div');
  obChat.className = 'ob-chat';
  const scroll = document.createElement('div');
  scroll.className = 'ob-chat__scroll';
  const transcript = document.createElement('div');
  transcript.className = 'ob-chat__transcript chat-area';
  transcript.dataset.testid = ORCHESTRATE_CHAT_PANE_TESTID;
  scroll.appendChild(transcript);
  obChat.appendChild(scroll);
  document.body.appendChild(obChat);

  return transcript;
}

function seedBoardTaskSession() {
  const planner = createEmptyChatObject('');
  planner.id = PLANNER_ID;
  planner.modeId = 'orchestrate';
  planner.orchestratePlanPath = 'documentation/plans/x.md';

  const task = createEmptyChatObject('');
  task.id = TASK_CHAT_ID;
  task.modeId = 'build';
  task.boardGroupId = 'grp-embed';
  task.boardTaskId = 'W1-A';

  const group = {
    id: 'grp-embed',
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
  return task;
}

describe('orchestrate board chat embed transcript', () => {
  afterEach(() => {
    setStreaming(false);
    setOpenBoardChatId(null);
    disposeBoardViewForTests();
    resetOrchestrateInitSplitForTests();
    setSessionStateForTests(null);
  });

  test('appendBubble paints user echo into embed host when embed is open', () => {
    const transcript = setupDom();
    seedBoardTaskSession();
    setOpenBoardChatId(TASK_CHAT_ID);

    const chatAreaBefore = document.getElementById('chatArea').childElementCount;
    const transcriptBefore = transcript.childElementCount;

    appendBubble('user', 'Hello from task chat');

    assert.equal(document.getElementById('chatArea').childElementCount, chatAreaBefore);
    assert.equal(transcript.childElementCount, transcriptBefore + 1);
    const msg = transcript.querySelector('.msg.user');
    assert.ok(msg);
    assert.match(msg.textContent ?? '', /Hello from task chat/);
  });

  test('appendStreamingAssistantRow mounts stream-status in embed when embed is open', () => {
    const transcript = setupDom();
    seedBoardTaskSession();
    setOpenBoardChatId(TASK_CHAT_ID);
    setStreaming(true, TASK_CHAT_ID);

    const { wrap, streamStatus } = appendStreamingAssistantRow(TASK_CHAT_ID);

    assert.equal(wrap.isConnected, true);
    assert.equal(transcript.contains(wrap), true);
    assert.ok(wrap.classList.contains('msg--awaiting-prose'));
    assert.ok(wrap.querySelector('.stream-status'));
  });

  test('bubbles and stream rows stay stubbed when embed is closed in board view', () => {
    const transcript = setupDom();
    seedBoardTaskSession();
    setStreaming(true, TASK_CHAT_ID);

    const chatAreaBefore = document.getElementById('chatArea').childElementCount;
    appendBubble('assistant', 'Suppressed prose');
    assert.equal(document.getElementById('chatArea').childElementCount, chatAreaBefore);
    assert.equal(transcript.querySelector('.msg.assistant'), null);

    const { wrap } = appendStreamingAssistantRow(TASK_CHAT_ID);
    assert.equal(wrap.isConnected, false);
    assert.equal(wrap.querySelector('.stream-status'), null);
  });

  test('ensureBoardChatComposerChrome restores main-column--board-chat while embed is open', () => {
    setupDom();
    seedBoardTaskSession();
    setOpenBoardChatId(TASK_CHAT_ID);
    const column = document.getElementById('mainColumn');
    column.classList.remove('main-column--board-chat');
    assert.equal(column.classList.contains('main-column--board-chat'), false);

    ensureBoardChatComposerChrome();
    assert.equal(column.classList.contains('main-column--board-chat'), true);
  });

  test('refreshActiveBoardIfMounted restores board-chat composer class when embed is open', () => {
    setupDom();
    seedBoardTaskSession();
    setOpenBoardChatId(TASK_CHAT_ID);
    const column = document.getElementById('mainColumn');
    column.classList.remove('main-column--board-chat');

    refreshActiveBoardIfMounted();
    assert.equal(column.classList.contains('main-column--board-chat'), true);
  });
});
