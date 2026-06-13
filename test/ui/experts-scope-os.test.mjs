import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import { initOsPageBridge, resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  resetOsRouterForTests,
} from '../../src/os/router.ts';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setExpertsPageOpen } from '../../src/app-state.ts';

function setupExpertScopeDom(win) {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="osStage"><div id="osAppsLayer"></div></div>
    <main id="expertsView" class="experts-page is-open"></main>
    <div id="appBody" class="hidden">
      <aside id="chatSidebar">
        <div id="expertScopeChrome" class="hidden" hidden></div>
        <div id="chatSidebarMain"></div>
      </aside>
      <div id="chatArea"></div>
    </div>
  `;
}

describe('expert scope OS routing', () => {
  /** @type {import('happy-dom').Window} */
  let win;

  beforeEach(async () => {
    win = new Window();
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.HTMLElement = win.HTMLElement;
    setupExpertScopeDom(win);
    win.location.hash = '#/app/experts';
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    initOsPageBridge();
    initOsRouter();
    setExpertsPageOpen(true);
    setSessionStateForTests({
      activeId: 'chat-1',
      chats: [
        {
          id: 'chat-1',
          kind: 'expert',
          expertId: 'software-engineer',
          expertSelection: { mode: 'manual', expertId: 'software-engineer' },
          name: 'Expert chat',
          history: [],
          modelId: '',
          modeId: 'general',
        },
      ],
    });
  });

  afterEach(() => {
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  test('openExpertChatInShell foregrounds the Code app', async () => {
    const { openExpertChatInShell } = await import('../../src/ui/experts/experts-scope.ts');
    const chat = {
      id: 'chat-1',
      kind: 'expert',
      expertId: 'software-engineer',
      expertSelection: { mode: 'manual', expertId: 'software-engineer' },
      name: 'Expert chat',
      history: [],
      modelId: '',
      modeId: 'general',
    };

    await openExpertChatInShell(chat);

    assert.equal(win.location.hash, '#/app/code');
    assert.equal(document.getElementById('expertsView')?.classList.contains('is-open'), false);
    assert.equal(document.getElementById('appBody')?.dataset.scope, 'expert');
  });
});
