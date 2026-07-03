import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetChatsWorkspacePathCache } from '../../src/lib/chats-workspace.ts';
import { resetDesktopWorkspacePathCache } from '../../src/lib/desktop-workspace.ts';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  activateDesktopChat,
  getDesktopState,
  isDesktopChatActive,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import { resetDesktopChatRailForTests } from '../../src/ui/desktop-chat-rail.ts';
import { resetDesktopWorkspaceMountsForTests } from '../../src/os/desktop-workspace-mounts.ts';
import { resetDesktopWorkspacePanelForTests } from '../../src/os/desktop-workspace-state.ts';
import { resetDesktopWorkspaceRailForTests } from '../../src/os/desktop-workspace-rail.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  launchApp,
  parseOsHash,
  resetOsRouterForTests,
  resolveLegacyHash,
  syncOsRouteFromHashForTests,
} from '../../src/os/router.ts';
import { renderDesktop } from '../../src/os/desktop.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

function setupDesktopDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osStage">
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="osAppsLayer"></div>
    </div>
    <div id="workspaceSplit">
      <aside id="fileSidebar"><div id="fileSidebarFilesView"></div></aside>
      <section id="previewPane" class="hidden"></section>
      <section id="fileViewerPane" class="hidden"></section>
    </div>
    <input type="file" id="fileInput" />
  `;
}

describe('desktop chat state', () => {
  let cleanupDesktop: (() => void) | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      localStorage: Storage;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.HTMLButtonElement = win.HTMLButtonElement;
    g.localStorage = win.localStorage;
    g.requestAnimationFrame = (cb: FrameRequestCallback) =>
      win.setTimeout(() => cb(win.performance.now()), 0) as unknown as number;
    g.getComputedStyle = win.getComputedStyle.bind(win);
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
    g.fetch = (async (input: string | URL) => {
      const url = String(input);
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
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    setupDesktopDom(win);
    resetChatsWorkspacePathCache();
    resetDesktopWorkspacePathCache();
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetDesktopChatRailForTests();
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspaceMountsForTests();
    resetDesktopWorkspaceRailForTests();
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
  });

  afterEach(() => {
    cleanupDesktop?.();
    cleanupDesktop = undefined;
    resetDesktopStateForTests();
    resetDesktopChatRailForTests();
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspaceMountsForTests();
    resetDesktopWorkspaceRailForTests();
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  test('starts in idle state without chat-active classes', () => {
    assert.equal(getDesktopState(), 'idle');
    assert.equal(isDesktopChatActive(), false);
    const layer = document.getElementById('osDesktopLayer');
    assert.ok(layer);
    assert.equal(layer?.classList.contains('is-chat-active'), false);
    assert.equal(layer?.classList.contains('is-composer-docked'), false);
  });

  test('activateDesktopChat applies chat-active and composer-docked classes', async () => {
    await activateDesktopChat();
    assert.equal(getDesktopState(), 'chatActive');
    assert.equal(isDesktopChatActive(), true);
    const layer = document.getElementById('osDesktopLayer');
    assert.equal(layer?.classList.contains('is-chat-active'), true);
    assert.equal(layer?.classList.contains('is-composer-docked'), true);
    assert.ok(document.getElementById('desktopChatCol'));
    assert.ok(document.getElementById('desktopInput'));
    assert.ok(document.getElementById('desktopSendBtn'));
    assert.ok(document.getElementById('desktopContextRing'));
  });

  test('activateDesktopChat with seed creates a new thread instead of reusing history', async () => {
    const DESKTOP_WS = '/home/user/.minnow/workspace';
    const { sessionState, getActiveChat } = await import('../../src/state/sessions.ts');
    const existing = sessionState!.chats[0]!;
    existing.workspacePath = DESKTOP_WS;
    existing.history.push({ role: 'user', content: 'prior turn' });
    const priorId = existing.id;
    const priorCount = sessionState!.chats.length;

    try {
      await activateDesktopChat({ seed: 'brand new question' });
    } catch {
      // Provider/model DOM is absent in this harness; chat creation is what we verify.
    }

    assert.equal(sessionState!.chats.length, priorCount + 1);
    assert.notEqual(getActiveChat().id, priorId);
    assert.equal(getActiveChat().workspacePath, DESKTOP_WS);
    assert.equal(getActiveChat().history.length, 0);
  });

  test('resolveLegacyHash redirects #/app/chat to desktop', () => {
    assert.deepEqual(resolveLegacyHash('#/app/chat'), {
      hash: '#/desktop',
      desktopChat: true,
    });
  });

  test('launchApp(chat) stays on desktop and activates chat', async () => {
    launchApp('chat');
    assert.equal(window.location.hash, '#/desktop');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(isDesktopChatActive(), true);
    assert.equal(getDesktopState(), 'chatActive');
  });

  test('parseOsHash still accepts desktop route', () => {
    assert.deepEqual(parseOsHash('#/desktop'), { view: 'desktop' });
  });
});
