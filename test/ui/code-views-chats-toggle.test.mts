import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { CHAT_SIDEBAR_CHANGED_EVENT } from '../../src/ui/layout-events.ts';
import { initCodeViewsChatsToggle } from '../../src/ui/code-views-chats-toggle.ts';
import { collapseChatSidebarForBoardEnter } from '../../src/ui/layout.ts';
import { syncSuperPlanChrome } from '../../src/ui/super-plan-chrome.ts';
import { resetMobileLayoutForTests } from '../../src/ui/mobile-layout.ts';
import { OB_CHAT_AREA_CLASS } from '../../src/ui/orchestrate-page-shell.ts';
import {
  createEmptyChatObject,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { getOrCreateBoardGroup } from '../../src/state/chat-groups.ts';
import { installHappyDomGlobals, teardownHappyDomAsync } from '../os/dom-helpers.mts';

describe('code views chats toggle', () => {
  let happyDomWindow: import('happy-dom').Window | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    happyDomWindow = win;
    installHappyDomGlobals(win);
    resetMobileLayoutForTests();

    win.document.body.innerHTML = `
      <nav class="code-views" id="codeViews">
        <button type="button" class="code-views__btn" id="btnCodeViewsChats"></button>
      </nav>
      <aside class="chat-sidebar" id="chatSidebar"></aside>
    `;

    initCodeViewsChatsToggle();
  });

  afterEach(async () => {
    setSessionStateForTests(null);
    if (happyDomWindow) await teardownHappyDomAsync(happyDomWindow);
  });

  test('syncs aria when chat sidebar visibility changes', () => {
    const btn = document.getElementById('btnCodeViewsChats');
    const side = document.getElementById('chatSidebar');
    assert.ok(btn);
    assert.ok(side);
    assert.ok(happyDomWindow);

    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.equal(btn.getAttribute('aria-label'), 'Hide chats');

    side.classList.add('collapsed');
    happyDomWindow.dispatchEvent(new happyDomWindow.CustomEvent(CHAT_SIDEBAR_CHANGED_EVENT));

    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(btn.getAttribute('aria-label'), 'Show chats');
  });

  test('shows Show chats while Super Plan hides the session list', () => {
    const btn = document.getElementById('btnCodeViewsChats');
    assert.ok(btn);
    assert.ok(happyDomWindow);

    syncSuperPlanChrome(true);

    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(btn.getAttribute('aria-label'), 'Show chats');
  });

  test('clicking Chats closes a Code overview stage view', async () => {
    const area = document.createElement('main');
    area.id = 'chatArea';
    const overview = document.createElement('div');
    overview.id = 'codeOverviewRoot';
    area.appendChild(overview);
    document.body.appendChild(area);

    happyDomWindow!.dispatchEvent(new happyDomWindow!.CustomEvent(CHAT_SIDEBAR_CHANGED_EVENT));

    const btn = document.getElementById('btnCodeViewsChats');
    assert.ok(btn);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');

    btn.click();
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(document.getElementById('codeOverviewRoot'), null);
  });

  test('collapseChatSidebarForBoardEnter hides an expanded session list', () => {
    setSessionStateForTests({
      version: 5,
      activeId: '11111111-1111-1111-1111-111111111111',
      sidebarCollapsed: false,
      groups: [],
      chats: [],
    });
    const side = document.getElementById('chatSidebar');
    assert.ok(side);
    assert.ok(sessionState);

    collapseChatSidebarForBoardEnter();

    assert.equal(sessionState.sidebarCollapsed, true);
    assert.equal(side.classList.contains('collapsed'), true);
  });

  test('clicking Chats expands the rail during orchestrate board view', () => {
    const ws = 'C:\\workspace\\demo';
    const planner = createEmptyChatObject('', ws);
    planner.id = '11111111-1111-1111-1111-111111111111';
    planner.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: planner.id,
      sidebarCollapsed: true,
      groups: [],
      chats: [planner],
    });
    const group = getOrCreateBoardGroup(planner);
    group.viewMode = 'board';
    assert.ok(sessionState);
    sessionState.activeBoardGroupId = group.id;
    sessionState.sidebarCollapsed = true;

    const area = document.createElement('main');
    area.id = 'chatArea';
    area.classList.add(OB_CHAT_AREA_CLASS);
    document.body.appendChild(area);

    const side = document.getElementById('chatSidebar');
    assert.ok(side);
    side.classList.add('collapsed');

    happyDomWindow!.dispatchEvent(new happyDomWindow!.CustomEvent(CHAT_SIDEBAR_CHANGED_EVENT));

    const btn = document.getElementById('btnCodeViewsChats');
    assert.ok(btn);
    assert.equal(btn.getAttribute('aria-label'), 'Show chats');

    btn.click();

    assert.equal(side.classList.contains('collapsed'), false);
    assert.equal(sessionState.sidebarCollapsed, false);
  });
});
