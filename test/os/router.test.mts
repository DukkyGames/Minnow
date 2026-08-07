import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetChatsWorkspacePathCache } from '../../src/lib/chats-workspace.ts';
import { initAppHost, resetAppHostForTests } from '../../src/os/app-host.ts';
import {
  isAppEnabled,
  resetAppPreferencesForTests,
  setAppEnabled,
} from '../../src/os/app-preferences.ts';
import {
  getForegroundAppId,
  getInstanceSnapshot,
  resetInstancesForTests,
} from '../../src/os/instances.ts';
import {
  isDesktopChatActive,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import { initOsPageBridge, resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  getCurrentRoute,
  initOsRouter,
  launchApp,
  navigateToDesktop,
  parseOsHash,
  resetOsRouterForTests,
  resolveLegacyHash,
  syncOsRouteFromHashForTests,
} from '../../src/os/router.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

const CHATS_WS = '/home/user/.minnow/chats';

function setupChatAppDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="osStage">
      <div id="osAppsLayer"></div>
    </div>
    <main id="chatView" class="chat-app-page">
      <div id="chatAppSessionList" class="chat-app-rail-list"></div>
      <div id="chatAppArea"></div>
      <h1 id="chatAppTitle">Chat</h1>
      <textarea id="chatAppInput"></textarea>
      <button type="button" id="chatAppSendBtn"></button>
      <aside id="chatAppFiles"><div id="chatAppFilesBody"></div></aside>
    </main>
    <div id="appBody"></div>
  `;
}

describe('resolveLegacyHash', () => {
  test('redirects settings paths to the settings app', () => {
    assert.deepEqual(resolveLegacyHash('#/settings/providers'), {
      hash: '#/app/models/providers',
      modelsSection: 'providers',
    });
    assert.deepEqual(resolveLegacyHash('#/settings'), {
      hash: '#/app/settings',
      settingsSection: 'general',
    });
  });

  test('resolveLegacyHash redirects #/desktop to workspaces', () => {
    assert.deepEqual(resolveLegacyHash('#/desktop'), { hash: '#/workspaces' });
  });

  test('resolveLegacyHash redirects #/app/chat to Code chat', () => {
    assert.deepEqual(resolveLegacyHash('#/app/chat'), {
      hash: '#/app/code/chat',
    });
  });

  test('redirects legacy #/settings/memory to Brain app', () => {
    assert.deepEqual(resolveLegacyHash('#/settings/memory'), {
      hash: '#/app/brain/memories',
      brainSection: 'memories',
    });
  });

  test('redirects legacy #/settings/knowledge to Agents rules', () => {
    assert.deepEqual(resolveLegacyHash('#/settings/knowledge'), {
      hash: '#/app/settings',
      settingsSection: 'rules',
    });
  });

  test('redirects legacy full-page routes to OS apps', () => {
    assert.deepEqual(resolveLegacyHash('#/benchmark'), { hash: '#/workspaces' });
    assert.deepEqual(resolveLegacyHash('#/research/run'), {
      hash: '#/app/code/chat',
      codeResearch: true,
    });
    assert.deepEqual(resolveLegacyHash('#/experts/gallery'), {
      hash: '#/app/experts',
    });
  });
});

describe('parseOsHash', () => {
  test('parses workspaces and app routes', () => {
    assert.deepEqual(parseOsHash('#/'), { view: 'workspaces' });
    assert.deepEqual(parseOsHash('#/workspaces'), { view: 'workspaces' });
    assert.deepEqual(parseOsHash('#/desktop'), { view: 'workspaces' });
    assert.deepEqual(parseOsHash('#/app/code'), {
      view: 'app',
      appId: 'code',
      codeSection: 'chat',
    });
    assert.deepEqual(parseOsHash('#/app/chat'), { view: 'workspaces' });
  });

  test('falls back to workspaces for unknown app ids', () => {
    assert.deepEqual(parseOsHash('#/app/unknown'), { view: 'workspaces' });
  });
});

describe('os router navigation', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      localStorage: Storage;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.localStorage = win.localStorage;
    win.localStorage.clear();
    win.document.body.innerHTML = `
      <header class="topbar"></header>
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="appBody"></div>
    `;
    win.location.hash = '#/workspaces';
    resetAppPreferencesForTests();
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    initOsRouter();
  });

  afterEach(() => {
    resetOsRouterForTests();
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    resetAppPreferencesForTests();
  });

  test('getCurrentRoute reflects legacy desktop hash as workspaces', () => {
    window.location.hash = '#/desktop';
    syncOsRouteFromHashForTests();
    assert.deepEqual(getCurrentRoute(), { view: 'workspaces' });
  });

  test('launchApp updates hash and foreground instance', () => {
    launchApp('code');
    assert.equal(window.location.hash, '#/app/code/chat');
    syncOsRouteFromHashForTests();
    const route = getCurrentRoute();
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'code');
  });

  test('launchApp keeps core scheduler available when disable is attempted', () => {
    setAppEnabled('scheduler', false);
    launchApp('scheduler');
    syncOsRouteFromHashForTests();
    assert.equal(isAppEnabled('scheduler'), true);
  });

  test('hash route for core research stays available when disable is attempted', () => {
    setAppEnabled('research', false);
    window.location.hash = '#/app/research';
    syncOsRouteFromHashForTests();
    // Research deep-links onto the Code chat surface.
    assert.equal(window.location.hash, '#/app/code/chat');
    assert.equal(isAppEnabled('research'), true);
  });

  test('legacy #/experts does not activate desktop experts when app is hidden', async () => {
    const { isDesktopExpertsActive, resetDesktopStateForTests } = await import(
      '../../src/os/desktop-state.ts'
    );
    resetDesktopStateForTests();
    window.location.hash = '#/experts/gallery';
    syncOsRouteFromHashForTests();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(isDesktopExpertsActive(), false);
  });

  test('hash route for a developer-hidden app falls back to workspaces', () => {
    window.location.hash = '#/app/email';
    syncOsRouteFromHashForTests();
    assert.equal(window.location.hash, '#/workspaces');
    assert.equal(getInstanceSnapshot().view, 'workspaces');
    assert.equal(
      getInstanceSnapshot().instances.some((inst) => inst.appId === 'email'),
      false,
    );
  });

  test('resolveLegacyHash redirects #/bugs to Issues (MIN-261)', () => {
    assert.deepEqual(resolveLegacyHash('#/bugs'), { hash: '#/app/issues' });
    assert.deepEqual(resolveLegacyHash('#/bugs/open'), { hash: '#/app/issues' });
  });

  test('parseOsHash prepares Issues deep-link issueId', () => {
    const route = parseOsHash('#/app/issues/ISS-42');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'issues');
    assert.equal(route.issueId, 'ISS-42');
  });

  test('applyRouteFromHash rewrites #/bugs to #/app/issues (MIN-261)', () => {
    window.location.hash = '#/bugs';
    syncOsRouteFromHashForTests();
    // First pass only rewrites the legacy hash (app launch is a separate sync).
    assert.equal(window.location.hash, '#/app/issues');
  });

  test('launchApp(chat) routes to Code chat workspace', async () => {
    launchApp('chat', { seed: 'summarize my notes' });
    assert.equal(window.location.hash, '#/app/code/chat');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'app');
    assert.equal(getForegroundAppId(), 'code');
  });

  test('launchApp(chat) from code stays on Code chat', () => {
    launchApp('code');
    assert.equal(getForegroundAppId(), 'code');
    launchApp('chat');
    syncOsRouteFromHashForTests();
    assert.equal(window.location.hash, '#/app/code/chat');
    assert.equal(getInstanceSnapshot().view, 'app');
    assert.equal(getForegroundAppId(), 'code');
  });

  test('launchApp(research) routes to Code research embed', async () => {
    const { isResearchPanelOpen, resetResearchPanelForTests } = await import(
      '../../src/ui/research-panel.ts',
    );
    resetResearchPanelForTests();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="chatArea"></div><div id="mainColumn"></div>
      <main id="researchView" class="research-page dr">
        <button id="researchTabRun"></button><button id="researchTabLibrary"></button>
        <div id="researchPanelRun"><textarea id="researchQuery"></textarea>
        <select id="researchMaxRounds"><option value="auto">Auto</option></select>
        <select id="researchCategory"><option value=""></option></select>
        <select id="researchSearchProvider"><option value=""></option></select>
        <select id="researchProviderOverride"><option value=""></option></select>
        <input id="researchModelOverride" />
        <button id="btnResearchStart"></button><button id="btnResearchCancel" hidden></button>
        <div id="researchProgressMount"></div><div id="researchResultMount"></div></div>
        <div id="researchPanelLibrary" class="hidden"></div><div id="researchLibraryMount"></div>
        <button id="btnResearchSettingsLink"></button></main>`,
    );
    launchApp('code');
    launchApp('research', { seed: 'Apple stock', autoRun: true });
    assert.equal(window.location.hash, '#/app/code/chat');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const snap = getInstanceSnapshot();
    assert.equal(snap.instances.find((i) => i.appId === 'research'), undefined);
    assert.equal(getForegroundAppId(), 'code');
    assert.equal(isResearchPanelOpen(), true);
  });

  test('launchApp(experts) blocks hidden app and returns to desktop', async () => {
    const { isDesktopExpertsActive, resetDesktopStateForTests } = await import(
      '../../src/os/desktop-state.ts'
    );
    resetDesktopStateForTests();
    launchApp('experts');
    assert.equal(window.location.hash, '#/workspaces');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'desktop');
    assert.equal(snap.instances.find((i) => i.appId === 'experts'), undefined);
    assert.equal(isDesktopExpertsActive(), false);
  });

  test('navigateToDesktop returns to workspaces view', () => {
    launchApp('code');
    syncOsRouteFromHashForTests();
    navigateToDesktop();
    assert.equal(window.location.hash, '#/workspaces');
    syncOsRouteFromHashForTests();
    assert.deepEqual(getCurrentRoute(), { view: 'workspaces' });
  });

  test('legacy settings hash resolves to settings app route', () => {
    window.location.hash = '#/settings/modes';
    const route = getCurrentRoute();
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'settings');
    assert.equal(route.settingsSection, 'modes');
  });

  test('applyRouteFromHash redirects legacy settings hash', () => {
    window.location.hash = '#/settings/modes';
    syncOsRouteFromHashForTests();
    assert.equal(window.location.hash, '#/app/settings');
    syncOsRouteFromHashForTests();
    assert.equal(getCurrentRoute().settingsSection, 'modes');
  });
});

describe('chat app OS integration', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    setupChatAppDom(win);
    win.location.hash = '#/workspaces';

    g.fetch = (async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes('/api/chats-workspace/list')) {
        return {
          ok: true,
          json: async () => ({ ok: true, entries: [] }),
        } as Response;
      }
      if (path.includes('/api/chats-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: CHATS_WS, fileCount: 0 }),
        } as Response;
      }
      // Provider/tools offline — concierge seed stays in composer for manual send.
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'offline' }),
      } as Response;
    }) as typeof fetch;

    resetChatsWorkspacePathCache();
    setSessionStateForTests({
      version: 5,
      activeId: 'chat-test-id',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: {},
      chats: [
        {
          ...createEmptyChatObject('chat-test-id'),
          name: 'Assistant',
          workspacePath: CHATS_WS,
          modeId: 'general',
          workAgentAuto: true,
        },
      ],
    });

    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    initOsPageBridge();
    initAppHost();
    initOsRouter();

    const input = document.getElementById('chatAppInput') as HTMLTextAreaElement | null;
    if (input) input.value = '';
    document.getElementById('chatView')?.classList.remove('is-open');
  });

  afterEach(async () => {
    const { closeChatApp, isChatAppOpen } = await import('../../src/ui/chat-app.ts');
    if (isChatAppOpen()) closeChatApp({ skipNavigate: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    resetChatsWorkspacePathCache();
    setSessionStateForTests(null);
  });

  test('launchApp(chat) from workspaces opens Code chat', async () => {
    launchApp('chat', { seed: 'summarize my notes' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'app');
    assert.equal(window.location.hash, '#/app/code/chat');
    assert.equal(getForegroundAppId(), 'code');
  });

  test('openChatApp applies seed to composer when empty', async () => {
    const { openChatApp, isChatAppOpen } = await import('../../src/ui/chat-app.ts');
    await openChatApp('draft a friendly email');
    const input = document.getElementById('chatAppInput') as HTMLTextAreaElement | null;
    assert.equal(input?.value, 'draft a friendly email');
    assert.equal(isChatAppOpen(), true);
  });

  test('openChatApp does not overwrite non-empty composer', async () => {
    const { openChatApp } = await import('../../src/ui/chat-app.ts');
    const input = document.getElementById('chatAppInput') as HTMLTextAreaElement | null;
    if (input) input.value = 'existing prompt';
    await openChatApp('ignored seed');
    assert.equal(input?.value, 'existing prompt');
  });

  test('closeChatApp clears open state and returns to desktop', async () => {
    const { openChatApp, closeChatApp, isChatAppOpen } = await import('../../src/ui/chat-app.ts');
    await openChatApp();
    assert.equal(isChatAppOpen(), true);
    closeChatApp();
    assert.equal(isChatAppOpen(), false);
    assert.equal(window.location.hash, '#/workspaces');
  });

  test('navigateToDesktop returns to workspaces after chat launch', async () => {
    const { openChatApp, isChatAppOpen } = await import('../../src/ui/chat-app.ts');

    launchApp('chat');
    syncOsRouteFromHashForTests();
    await openChatApp();
    assert.equal(isChatAppOpen(), true);
    navigateToDesktop();
    syncOsRouteFromHashForTests();
    assert.equal(getCurrentRoute().view, 'workspaces');
    assert.equal(window.location.hash, '#/workspaces');
  });
});
