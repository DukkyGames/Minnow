import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { initAppHost, resetAppHostForTests } from '../../src/os/app-host.ts';
import {
  getForegroundAppId,
  resetInstancesForTests,
} from '../../src/os/instances.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  resetOsRouterForTests,
} from '../../src/os/router.ts';
import { setExpertsPageOpen } from '../../src/app-state.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  installHappyDomGlobals,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

function setupExpertsDom(win) {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="osStage">
      <div id="osAppsLayer">
        <main id="expertsView" class="experts-page is-open" data-step="browse">
          <div id="expertsList"></div>
        </main>
      </div>
    </div>
    <div id="appBody">
      <div id="chatArea"></div>
      <textarea id="msgInput"></textarea>
      <button type="button" id="sendBtn"></button>
    </div>
  `;
}

describe('expert scope OS routing', () => {
  /** @type {import('happy-dom').Window} */
  let win;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    installHappyDomGlobals(win, {
      fetch: async () => ({
        ok: true,
        json: async () => ({ experts: { enabled: true } }),
      }),
    });
    setupExpertsDom(win);
    win.location.hash = '#/app/experts';
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    initAppHost();
    initOsRouter();
    setExpertsPageOpen(true);
    setSessionStateForTests({
      version: 5,
      activeId: 'chat-1',
      sidebarCollapsed: false,
      groups: [],
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
          workspacePath: '',
          workAgentId: null,
          workAgentAuto: true,
          lastStats: null,
          modelInfo: {},
          updatedAt: 1,
          lastMessageAt: 1,
        },
      ],
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: {},
    });
  });

  afterEach(async () => {
    setSessionStateForTests(null);
    setExpertsPageOpen(false);
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('openExpertChatInShell launches Code instead of desktop chat', async () => {
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
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(document.getElementById('expertsView')?.classList.contains('is-open'), false);
    assert.equal(getForegroundAppId(), 'code');
    assert.match(win.location.hash, /#\/app\/code/);
  });
});
