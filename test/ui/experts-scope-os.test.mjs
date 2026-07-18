import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { initAppHost, resetAppHostForTests } from '../../src/os/app-host.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  consumePendingDesktopExpertsActivation,
  getDesktopState,
  isDesktopChatActive,
  isDesktopExpertsActive,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  resetOsRouterForTests,
} from '../../src/os/router.ts';
import { renderDesktop } from '../../src/os/desktop.ts';
import { resetWindowManagerForTests } from '../../src/os/window-manager.ts';
import { setExpertsPageOpen } from '../../src/app-state.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  installHappyDomGlobals,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

function setupDesktopDom(win) {
  win.document.body.innerHTML = `
    <div id="osStage">
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="osAppsLayer">
        <main id="expertsView" class="experts-page is-open" data-step="browse">
          <header class="experts-hdr">
            <div class="experts-hdr-spacer"></div>
            <button type="button" class="experts-hdr-btn" id="btnExpertsNew">New expert</button>
          </header>
          <div id="expertsList"></div>
          <div id="expertsDetailMount"></div>
          <div id="expertsDisabled" class="hidden"></div>
        </main>
      </div>
    </div>
    <div id="appBody" class="hidden">
      <aside id="chatSidebar">
        <div id="expertScopeChrome" class="hidden" hidden></div>
        <div id="chatSidebarMain"></div>
      </aside>
      <div id="chatArea"></div>
    </div>
    <input type="file" id="fileInput" />
    <div id="stripTPS">—</div>
    <div id="stripTTFT">—</div>
    <div id="stripGen">—</div>
    <div id="stripTotal">—</div>
    <div id="stripCost">—</div>
    <div id="barPrompt"></div>
    <div id="barCompletion"></div>
    <div id="cntPrompt">—</div>
    <div id="cntCompletion">—</div>
    <div id="iArch">—</div>
    <div id="iQuant">—</div>
    <div id="iCtx">—</div>
    <div id="iStop">—</div>
    <div id="statsExpandPreview"></div>
    <select id="modelSelect"></select>
    <textarea id="msgInput"></textarea>
    <button type="button" id="sendBtn"></button>
  `;
}

describe('expert scope OS routing', () => {
  /** @type {import('happy-dom').Window} */
  let win;
  let cleanupDesktop;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    const fetchImpl = (async (input) => {
      const raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, 'http://localhost:5173').href;
      if (url.includes('/api/config/experts') || url.includes('/api/config/meta')) {
        return {
          ok: true,
          json: async () => ({ experts: { enabled: true } }),
        };
      }
      if (url.includes('/api/prompts/experts')) {
        return { ok: true, json: async () => ({ files: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    installHappyDomGlobals(win, { fetch: fetchImpl });
    setupDesktopDom(win);
    win.location.href = 'http://localhost:5173/#/desktop';
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    resetWindowManagerForTests();
    const layer = document.getElementById('osDesktopLayer');
    cleanupDesktop = renderDesktop(layer);
    initAppHost();
    initOsRouter();
    consumePendingDesktopExpertsActivation();
    const { activateDesktopExperts } = await import('../../src/os/desktop-state.ts');
    await activateDesktopExperts({ expertId: 'software-engineer' });
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
    cleanupDesktop?.();
    cleanupDesktop = undefined;
    setSessionStateForTests(null);
    setExpertsPageOpen(false);
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    resetWindowManagerForTests();
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('openExpertChatInShell activates desktop chat without launching Code', async () => {
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
    consumePendingDesktopExpertsActivation();
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(win.location.hash === '#/desktop' || win.location.hash === '#/app/experts');
    assert.equal(document.getElementById('expertsView')?.classList.contains('is-open'), false);
    assert.equal(isDesktopChatActive(), true);
    assert.equal(getDesktopState(), 'chatActive');
    assert.ok(document.getElementById('desktopChatCol'));
    assert.equal(isDesktopExpertsActive(), false);
  });
});
