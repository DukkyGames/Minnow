/**
 * Opening Orchestrate / launching a plan must not create a planner chat (MIN-715).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import {
  createEmptyChatObject,
  getActiveChat,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { launchBoardFromPlan } from '../../src/ui/orchestrate-launch.ts';

const WORKSPACE = '/tmp/orchestrate-p4c-no-chat';

function setupDom() {
  const win = new Window();
  installHappyDomGlobals(win);
  for (const [id, tag] of [
    ['chatArea', 'div'],
    ['mainColumn', 'div'],
  ] as const) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

describe('launchBoardFromPlan creates no chat', () => {
  afterEach(() => {
    setSessionStateForTests(null);
    document.body.innerHTML = '';
  });

  test('a blank plan path is a no-op and does not add a chat row', async () => {
    setupDom();
    const existing = createEmptyChatObject('m1');
    existing.workspacePath = WORKSPACE;
    existing.modeId = 'build';
    setSessionStateForTests({
      version: 5,
      activeId: existing.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [existing],
    });

    const result = await launchBoardFromPlan('   ');
    assert.equal(result, null);
    assert.equal(sessionState?.chats.length, 1);
    assert.equal(getActiveChat().id, existing.id);
  });
});
