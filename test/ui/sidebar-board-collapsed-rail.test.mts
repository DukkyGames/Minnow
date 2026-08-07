/**
 * Orchestrate boards on the collapsed chat sidebar icon rail.
 * Only the board group header remains; waves and member chats stay hidden.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  installHappyDomGlobals,
  setupMinimalComposerDom,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import {
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const WS = '/tmp/sidebar-board-rail';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const TASK_CHAT_ID = '22222222-2222-2222-2222-222222222222';

/** @type {import('happy-dom').Window | undefined} */
let win: InstanceType<typeof Window> | undefined;

function setupDom(collapsed: boolean, mobileOpen = false): void {
  win = new Window();
  installHappyDomGlobals(win);
  setupMinimalComposerDom(document);

  const side = document.createElement('aside');
  side.id = 'chatSidebar';
  side.className = 'chat-sidebar';
  if (collapsed) side.classList.add('collapsed');
  if (mobileOpen) side.classList.add('mobile-open');

  const list = document.createElement('div');
  list.id = 'chatList';
  list.className = 'chat-list';
  side.appendChild(list);
  document.body.appendChild(side);
}

function seedBoardSession(sidebarCollapsed: boolean): { planner: Chat; taskChat: Chat; group: ChatGroup } {
  setWorkspaceFromServer({ path: WS, label: 'rail', isDefault: false });

  const planner = createEmptyChatObject('m1', WS);
  planner.id = PLANNER_ID;
  planner.name = 'Planner';
  planner.modeId = 'orchestrate';
  planner.groupId = GROUP_ID;
  planner.boardGroupId = GROUP_ID;
  planner.history.push({ role: 'user', content: 'plan' });

  const taskChat = createEmptyChatObject('m1', WS);
  taskChat.id = TASK_CHAT_ID;
  taskChat.name = 'Build auth';
  taskChat.modeId = 'build';
  taskChat.groupId = GROUP_ID;
  taskChat.boardGroupId = GROUP_ID;
  taskChat.boardTaskId = 'T1';
  taskChat.history.push({ role: 'user', content: 'build' });

  const group: ChatGroup = {
    id: GROUP_ID,
    name: 'Auth board',
    workspacePath: WS,
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: PLANNER_ID,
  };

  initBoard(group, planner, {
    planPath: 'documentation/plans/rail.md',
    waves: [{ id: 6 }],
    tasks: [{ id: 'T1', title: 'Build auth', wave: 6, category: 'build' }],
  });

  setSessionStateForTests({
    version: 5,
    activeId: PLANNER_ID,
    chats: [planner, taskChat],
    groups: [group],
    sidebarCollapsed,
  });

  return { planner, taskChat, group };
}

describe('sidebar board collapsed rail', { concurrency: false }, () => {
  afterEach(async () => {
    setSessionStateForTests(null);
    resetWorkspaceStateForTests();
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('icon rail shows only the board group header', async () => {
    setupDom(true);
    seedBoardSession(true);
    const { renderSidebar } = await import('../../src/ui/sidebar.ts');
    renderSidebar();

    const list = document.getElementById('chatList');
    assert.ok(list);
    assert.ok(list.querySelector('.chat-group-header--has-board'));
    assert.equal(list.querySelectorAll('.chat-group-members').length, 0);
    assert.equal(list.querySelectorAll('.chat-wave-subgroup-header').length, 0);
    const rows = list.querySelectorAll('.chat-item-row');
    assert.ok(rows.length <= 1);
    if (rows.length === 1) {
      assert.equal(rows[0]?.dataset.chatId, PLANNER_ID);
    }
  });

  test('expanded sidebar keeps wave subgroup headers and members', async () => {
    setupDom(false);
    seedBoardSession(false);
    const { renderSidebar } = await import('../../src/ui/sidebar.ts');
    renderSidebar();

    const list = document.getElementById('chatList');
    assert.ok(list);
    assert.equal(list.querySelectorAll('.chat-wave-subgroup-header').length, 1);
    assert.match(list.querySelector('.chat-wave-subgroup-header')?.textContent ?? '', /Wave 6/);
    const taskRow = list.querySelector<HTMLElement>(`.chat-item-row[data-chat-id="${TASK_CHAT_ID}"]`);
    assert.ok(taskRow);
    assert.ok(taskRow.querySelector('.chat-item-board-cat-icon'));
    assert.equal(taskRow.querySelectorAll('.chat-item-icon').length, 0);
    assert.equal(taskRow.querySelectorAll('.chat-item-board-cat-icon').length, 1);
  });
});
