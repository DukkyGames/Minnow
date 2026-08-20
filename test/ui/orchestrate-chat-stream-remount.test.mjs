/**
 * Orchestrator board → chat view restores stream-status while planner streams.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { initBoard } = await import('../../src/state/orchestrate-board-store.ts');
const { renderBoardView, disposeBoardViewForTests } = await import(
  '../../src/ui/orchestrate-board.ts'
);
const { registerStreamDomRemount } = await import('../../src/tools/stream-chat-dom.ts');
const { setOrchestrateViewMode } = await import('../../src/ui/view-mode-toggle.ts');
const { setStreaming } = await import('../../src/app-state.ts');
const { setSidebarStreamPhase } = await import('../../src/ui/chat-item-dot.ts');
const { registerStreamDomRemount } = await import('../../src/tools/stream-chat-dom.ts');
const { STREAM_LABEL_GENERATING } = await import('../../src/ui/stream-status.ts');

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

function makeOrchestrateChat() {
  const chat = createEmptyChatObject('');
  chat.id = FIXED_CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = PLAN_PATH;
  return chat;
}

function initBoardForChat(chat, input) {
  const group = {
    id: FIXED_GROUP_ID,
    name: 'Board',
    workspacePath: chat.workspacePath || '',
    collapsed: false,
    order: 0,
    createdAt: 1,
    viewMode: 'board',
    plannerChatId: chat.id,
    orchestratePlanPath: PLAN_PATH,
  };
  initBoard(group, chat, input);
  chat.boardGroupId = group.id;
  chat.groupId = group.id;
  return group;
}

describe('orchestrate chat stream remount', { concurrency: false }, () => {
  afterEach(() => {
    setStreaming(false);
    registerStreamDomRemount(FIXED_CHAT_ID, null);
    disposeBoardViewForTests();
    setSessionStateForTests(null);
  });

  test('setOrchestrateViewMode chat remounts Generating response… while planner streams', async () => {
    setupDom();
    const chat = makeOrchestrateChat();
    chat.history = [{ role: 'user', content: 'Run the plan' }];
    const group = initBoardForChat(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'Task A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      activeBoardGroupId: group.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [group],
    });
    setStreaming(true, chat.id);
    setSidebarStreamPhase('generating', chat.id);
    // Planner turn loop registers an owner before board/chat view switches.
    registerStreamDomRemount(chat.id, () => {});

    renderBoardView(group);
    assert.equal(document.querySelector('.stream-status'), null);

    setOrchestrateViewMode('chat');
    let label = null;
    for (let i = 0; i < 50; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      label = document.querySelector('.stream-status__label');
      if (label?.textContent === STREAM_LABEL_GENERATING) break;
    }

    assert.equal(label?.textContent, STREAM_LABEL_GENERATING);
  });
});
