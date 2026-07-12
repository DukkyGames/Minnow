import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import {
  activateDesktopChat,
  activateDesktopExperts,
  activateDesktopResearch,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
  shouldHideAppBody,
} from '../../src/os/page-bridge.ts';
import { initOsRouter, resetOsRouterForTests } from '../../src/os/router.ts';
import { renderDesktop } from '../../src/os/desktop.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="appBody"></div>
    <div id="osStage">
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="osAppsLayer"></div>
    </div>
    <input type="file" id="fileInput" />
  `;
}

function installFetchStub(win: import('happy-dom').Window): void {
  const fetchImpl = (async (input: string | URL | Request) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(raw, 'http://localhost:5173').href;
    if (url.includes('/api/desktop-workspace')) {
      return {
        ok: true,
        json: async () => ({ ok: true, path: '/home/user/.minnow/workspace', fileCount: 0 }),
      } as Response;
    }
    if (url.includes('/api/chats-workspace')) {
      return {
        ok: true,
        json: async () => ({ ok: true, path: '/home/user/.minnow/chats', fileCount: 0 }),
      } as Response;
    }
    if (url.includes('/api/config/research')) {
      return {
        ok: true,
        json: async () => ({ model: { providerId: '', model: '' }, maxRounds: 0 }),
      } as Response;
    }
    if (url.includes('/api/config/experts') || url.includes('/api/config/meta')) {
      return {
        ok: true,
        json: async () => ({ experts: { enabled: true } }),
      } as Response;
    }
    if (url.includes('/api/prompts/experts')) {
      return { ok: true, json: async () => ({ files: [] }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;
  win.fetch = fetchImpl;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchImpl;
}

describe('page-bridge code foreground', () => {
  let cleanupDesktop: (() => void) | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      HTMLButtonElement: typeof HTMLButtonElement;
      localStorage: Storage;
      requestAnimationFrame: typeof requestAnimationFrame;
      getComputedStyle: typeof getComputedStyle;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.HTMLButtonElement = win.HTMLButtonElement;
    g.localStorage = win.localStorage;
    g.getComputedStyle = win.getComputedStyle.bind(win);
    g.requestAnimationFrame = (cb: FrameRequestCallback) =>
      win.setTimeout(() => cb(win.performance.now()), 0) as unknown as number;
    win.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    installFetchStub(win);
    setupDom(win);
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    setSessionStateForTests({
      activeId: 'chat-1',
      chats: [createEmptyChatObject('chat-1', 'Test chat')],
    });
    const layer = document.getElementById('osDesktopLayer')!;
    cleanupDesktop = renderDesktop(layer);
    initOsRouter();
    initOsPageBridge();
  });

  afterEach(() => {
    cleanupDesktop?.();
    cleanupDesktop = undefined;
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  test('keeps #appBody visible when Code is foreground over desktop chat', async () => {
    await activateDesktopChat();
    assert.equal(shouldHideAppBody(), true);

    launchInstance('code');
    assert.equal(shouldHideAppBody(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
    assert.equal(document.documentElement.dataset.osApp, 'code');
    assert.equal(document.documentElement.classList.contains('os-desktop-chat'), false);
    assert.equal(
      document.getElementById('osDesktopLayer')?.classList.contains('is-suppressed-by-fullscreen-app'),
      true,
    );
  });

  test('keeps #appBody visible when Code is foreground over desktop research', async () => {
    await activateDesktopResearch();
    assert.equal(shouldHideAppBody(), true);

    launchInstance('code');
    assert.equal(shouldHideAppBody(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
    assert.equal(document.documentElement.dataset.osApp, 'code');
    assert.equal(document.documentElement.classList.contains('os-desktop-research'), false);
    assert.equal(
      document.getElementById('osDesktopLayer')?.classList.contains('is-suppressed-by-fullscreen-app'),
      true,
    );
  });

  test('keeps #appBody visible when Code is foreground over desktop experts', async () => {
    await activateDesktopExperts();
    assert.equal(shouldHideAppBody(), true);

    launchInstance('code');
    assert.equal(shouldHideAppBody(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
    assert.equal(document.documentElement.dataset.osApp, 'code');
    assert.equal(document.documentElement.classList.contains('os-desktop-experts'), false);
    assert.equal(
      document.getElementById('osDesktopLayer')?.classList.contains('is-suppressed-by-fullscreen-app'),
      true,
    );
  });
});
