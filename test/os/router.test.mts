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

  test('resolveLegacyHash redirects #/app/chat to desktop', () => {
    assert.deepEqual(resolveLegacyHash('#/app/chat'), {
      hash: '#/desktop',
      desktopChat: true,
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
    assert.deepEqual(resolveLegacyHash('#/benchmark'), { hash: '#/app/bench' });
    assert.deepEqual(resolveLegacyHash('#/research/run'), {
      hash: '#/desktop',
      desktopResearch: true,
    });
    assert.deepEqual(resolveLegacyHash('#/experts/gallery'), {
      hash: '#/desktop',
      desktopExperts: true,
    });
  });
});

describe('parseOsHash', () => {
  test('parses desktop and app routes', () => {
    assert.deepEqual(parseOsHash('#/'), { view: 'desktop' });
    assert.deepEqual(parseOsHash('#/desktop'), { view: 'desktop' });
    assert.deepEqual(parseOsHash('#/app/code'), {
      view: 'app',
      appId: 'code',
      codeSection: 'chat',
    });
    assert.deepEqual(parseOsHash('#/app/chat'), { view: 'app', appId: 'chat' });
  });

  test('falls back to desktop for unknown app ids', () => {
    assert.deepEqual(parseOsHash('#/app/unknown'), { view: 'desktop' });
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
    win.location.hash = '#/desktop';
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

  test('getCurrentRoute reflects desktop hash', () => {
    window.location.hash = '#/desktop';
    syncOsRouteFromHashForTests();
    assert.deepEqual(getCurrentRoute(), { view: 'desktop' });
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
    // Research deep-links onto the desktop research surface.
    assert.equal(window.location.hash, '#/desktop');
    assert.equal(isAppEnabled('research'), true);
  });

  test('hash route for a developer-hidden app falls back to desktop', () => {
    window.location.hash = '#/app/email';
    syncOsRouteFromHashForTests();
    assert.equal(window.location.hash, '#/desktop');
    assert.equal(getInstanceSnapshot().view, 'desktop');
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

  test('launchApp(chat) redirects to desktop chat', async () => {
    const { isDesktopChatActive, resetDesktopStateForTests } = await import(
      '../../src/os/desktop-state.ts'
    );
    resetDesktopStateForTests();
    launchApp('chat', { seed: 'summarize my notes' });
    assert.equal(window.location.hash, '#/desktop');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'desktop');
    assert.equal(snap.instances.find((i) => i.appId === 'chat'), undefined);
    assert.equal(isDesktopChatActive(), true);
  });

  test('launchApp(chat) from code prepares desktop chat before showDesktop emit', () => {
    launchApp('code');
    assert.equal(getForegroundAppId(), 'code');
    launchApp('chat');
    syncOsRouteFromHashForTests();
    assert.equal(window.location.hash, '#/desktop');
    assert.equal(getInstanceSnapshot().view, 'desktop');
    assert.equal(isDesktopChatActive(), true);
    const layer = document.getElementById('osDesktopLayer');
    assert.equal(layer?.classList.contains('is-chat-active'), true);
  });

  test('launchApp(research) redirects to desktop research', async () => {
    const { isDesktopResearchActive, resetDesktopStateForTests } = await import(
      '../../src/os/desktop-state.ts'
    );
    resetDesktopStateForTests();
    launchApp('research', { seed: 'Apple stock', autoRun: true });
    assert.equal(window.location.hash, '#/desktop');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'desktop');
    assert.equal(snap.instances.find((i) => i.appId === 'research'), undefined);
    assert.equal(isDesktopResearchActive(), true);
  });

  test('launchApp(experts) blocks hidden app and returns to desktop', async () => {
    const { isDesktopExpertsActive, resetDesktopStateForTests } = await import(
      '../../src/os/desktop-state.ts'
    );
    resetDesktopStateForTests();
    launchApp('experts');
    assert.equal(window.location.hash, '#/desktop');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'desktop');
    assert.equal(snap.instances.find((i) => i.appId === 'experts'), undefined);
    assert.equal(isDesktopExpertsActive(), false);
  });

  test('navigateToDesktop returns to desktop view', () => {
    launchApp('chat');
    syncOsRouteFromHashForTests();
    navigateToDesktop();
    assert.equal(window.location.hash, '#/desktop');
    syncOsRouteFromHashForTests();
    assert.deepEqual(getCurrentRoute(), { view: 'desktop' });
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
    win.location.hash = '#/desktop';

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

  test('launchApp(chat) from desktop activates desktop chat', async () => {
    const { isDesktopChatActive, resetDesktopStateForTests } = await import(
      '../../src/os/desktop-state.ts'
    );
    resetDesktopStateForTests();
    launchApp('chat', { seed: 'summarize my notes' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'desktop');
    assert.equal(window.location.hash, '#/desktop');
    assert.equal(isDesktopChatActive(), true);
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
    assert.equal(window.location.hash, '#/desktop');
  });

  test('navigateToDesktop returns to desktop route after chat launch', async () => {
    const { openChatApp, isChatAppOpen } = await import('../../src/ui/chat-app.ts');

    launchApp('chat');
    syncOsRouteFromHashForTests();
    await openChatApp();
    assert.equal(isChatAppOpen(), true);
    navigateToDesktop();
    syncOsRouteFromHashForTests();
    assert.equal(getCurrentRoute().view, 'desktop');
    assert.equal(window.location.hash, '#/desktop');
  });
});
