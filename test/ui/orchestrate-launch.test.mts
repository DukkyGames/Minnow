/**
 * Board planners must not be reused when starting another board in the same workspace.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { getOrCreateBoardGroup } from '../../src/state/chat-groups.ts';
import {
  createEmptyChatObject,
  getActiveChat,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { createChatWithMode } from '../../src/ui/sidebar.ts';

const WORKSPACE = '/tmp/orchestrate-board-anchor-test';

function setupDom() {
  const win = new Window();
  installHappyDomGlobals(win);
  for (const [id, tag] of [
    ['chatArea', 'div'],
    ['mainColumn', 'div'],
    ['modelSelect', 'select'],
    ['sendBtn', 'button'],
    ['msgInput', 'textarea'],
  ] as const) {
    const el = document.createElement(tag);
    el.id = id;
    if (tag === 'button') (el as HTMLButtonElement).type = 'button';
    document.body.appendChild(el);
  }
}

describe('createChatWithMode board anchor reuse', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('does not reuse an orchestrate planner that already owns a board folder', () => {
    setupDom();

    const planner = createEmptyChatObject('m1');
    planner.workspacePath = WORKSPACE;
    planner.modeId = 'orchestrate';

    setSessionStateForTests({
      version: 5,
      activeId: planner.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [planner],
    });

    const group = getOrCreateBoardGroup(planner);
    initBoard(group, planner, {
      planPath: 'documentation/plans/first.md',
      tasks: [{ id: 'W1-A', title: 'One', wave: 'W1', category: 'build', build: 'x', test: 'y' }],
      waves: [{ id: 'W1' }],
    });

    const created = createChatWithMode({ modeId: 'orchestrate' });
    assert.equal(created.ok, true);
    assert.notEqual(created.chatId, planner.id);
    assert.equal(getActiveChat().id, created.chatId);
    assert.equal((sessionState?.groups ?? []).length, 1);
    assert.equal((sessionState?.chats ?? []).length, 2);
  });
});
