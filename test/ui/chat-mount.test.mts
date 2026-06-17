/**
 * Chat mount / composer foreground resolution (MIN-171).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  activateDesktopChat,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
    <main id="chatView" class="chat-app-page is-open"></main>
    <div id="desktopChatCol"></div>
    <textarea id="msgInput"></textarea>
    <textarea id="chatAppInput"></textarea>
    <textarea id="desktopInput"></textarea>
    <button id="sendBtn"></button>
    <button id="chatAppSendBtn"></button>
    <button id="desktopSendBtn"></button>
  `;
}

describe('chat-mount foreground', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    setupDom(win);
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetDesktopStateForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  test('isChatAppForeground is false when Code is foreground but chatView stays is-open', async () => {
    const { isChatAppForeground } = await import('../../src/ui/chat-mount.ts');
    const { getActiveComposerSurface } = await import('../../src/ui/composer-surface.ts');

    assert.equal(isChatAppForeground(), true);

    launchInstance('code');

    assert.equal(isChatAppForeground(), false);
    assert.equal(getActiveComposerSurface().inputEl?.id, 'msgInput');
  });

  test('isChatAppForeground is false when Code is foreground while desktop chat stays active', async () => {
    const g = globalThis as typeof globalThis & { fetch: typeof fetch };
    g.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/chats-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: '/home/user/.minnow/chats', fileCount: 0 }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;

    setSessionStateForTests({
      version: 5,
      activeId: 'assistant-chat',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: { chat: 'assistant-chat' },
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'assistant-chat',
          name: 'Desktop hello',
          workspacePath: '/home/user/.minnow/chats',
          modeId: 'general',
        },
      ],
    });

    await activateDesktopChat();
    const { isChatAppForeground } = await import('../../src/ui/chat-mount.ts');
    assert.equal(isChatAppForeground(), true);

    launchInstance('code');
    assert.equal(isChatAppForeground(), false);
  });

  test('isChatAppForeground stays true for legacy chatView.is-open without OS foreground', async () => {
    resetOsPageBridgeForTests();
    const { isChatAppForeground } = await import('../../src/ui/chat-mount.ts');

    assert.equal(isChatAppForeground(), true);
  });
});
