/**
 * The Orchestrate rail must not rebuild itself on every frame of a live run.
 *
 * A running board emits a change per stream token, so `refreshActiveBoardIfMounted`
 * repaints the rail on every animation frame. Rebuilding ~90 rows at that rate
 * saturates the main thread and swaps the row out from under an in-flight click,
 * which is what made an open board chat unusable while the board ran.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { paintOrchestrateChatRail } from '../../src/ui/orchestrate-page-shell.ts';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';
import { installHappyDomGlobals, teardownHappyDomAsync } from '../os/dom-helpers.mts';

const WS = 'C:\\workspace\\rail-repaint';

function seed(): { group: ChatGroup; planner: Chat; build: Chat } {
  const planner = createEmptyChatObject('', WS);
  planner.id = 'chat-planner';
  planner.name = 'Planner';
  const build = createEmptyChatObject('', WS);
  build.id = 'chat-build';
  build.name = 'Arcade flight math';

  const group = {
    id: 'grp_board',
    name: 'plane-game',
    workspacePath: WS,
    order: 0,
    createdAt: 1,
    plannerChatId: planner.id,
    orchestrateBoard: {
      tasks: [
        { id: 'w1-flight', title: 'Flight', wave: 'w1', category: 'build', status: 'in_progress', chatId: build.id },
      ],
      waves: [{ id: 'w1', status: 'in_progress' }],
    },
  } as unknown as ChatGroup;

  setSessionStateForTests({
    version: 5,
    activeId: build.id,
    sidebarCollapsed: false,
    chats: [planner, build],
    groups: [group],
  });
  return { group, planner, build };
}

describe('orchestrate chat rail repaint', () => {
  let win: import('happy-dom').Window | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    installHappyDomGlobals(win);
  });

  afterEach(async () => {
    setSessionStateForTests(null);
    if (win) await teardownHappyDomAsync(win);
    win = undefined;
  });

  test('an unchanged repaint keeps the existing row nodes', () => {
    const { group, build } = seed();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const options = { group, activeChatId: build.id, onSelectChat: () => {}, onBack: () => {} };

    paintOrchestrateChatRail(container, options);
    const firstRow = container.querySelector('.ob-row');
    assert.ok(firstRow);

    paintOrchestrateChatRail(container, options);
    assert.equal(
      container.querySelector('.ob-row'),
      firstRow,
      'repaint with identical state must not rebuild the rail',
    );
  });

  test('a renamed chat still repaints', () => {
    const { group, build } = seed();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const options = { group, activeChatId: build.id, onSelectChat: () => {}, onBack: () => {} };

    paintOrchestrateChatRail(container, options);
    const firstRow = container.querySelector('.ob-row');

    build.name = 'Arcade flight math + fuel';
    paintOrchestrateChatRail(container, options);

    assert.notEqual(container.querySelector('.ob-row'), firstRow);
    assert.match(container.textContent ?? '', /fuel/);
  });

  test('selecting another chat repaints so is-active moves', () => {
    const { group, planner, build } = seed();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const base = { group, onSelectChat: () => {}, onBack: () => {} };

    paintOrchestrateChatRail(container, { ...base, activeChatId: build.id });
    paintOrchestrateChatRail(container, { ...base, activeChatId: planner.id });

    const active = container.querySelector('.ob-row.is-active') as HTMLElement | null;
    assert.equal(active?.dataset.chatId, planner.id);
  });
});
