/**
 * Chat mount / composer foreground resolution (MIN-171).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
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
    <aside class="email-assistant-dock is-open" aria-hidden="false">
      <div id="emailAssistantMessageCol"></div>
      <div class="email-assistant-scroll"></div>
      <textarea id="emailAssistantInput"></textarea>
      <button id="emailAssistantSendBtn"></button>
    </aside>
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

  test('composer uses Code input when Code is foreground while desktop chat stays active', async () => {
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
          workspacePath: '/home/user/.minnow/workspace',
          modeId: 'desktop',
        },
      ],
    });

    setDesktopStateForTests('chatActive');
    const { isChatAppForeground } = await import('../../src/ui/chat-mount.ts');
    const { getActiveComposerSurface } = await import('../../src/ui/composer-surface.ts');
    assert.equal(isChatAppForeground(), true);
    assert.equal(getActiveComposerSurface().inputEl?.id, 'desktopInput');

    launchInstance('code');
    assert.equal(isChatAppForeground(), false);
    assert.equal(getActiveComposerSurface().inputEl?.id, 'msgInput');
  });

  test('shouldPaintDesktopChatSurface is false when Code is foreground', async () => {
    const { shouldPaintDesktopChatSurface } = await import('../../src/ui/chat-mount.ts');

    setDesktopStateForTests('chatActive');
    assert.equal(shouldPaintDesktopChatSurface(), true);

    launchInstance('code');
    assert.equal(shouldPaintDesktopChatSurface(), false);
  });

  test('isChatAppForeground stays true for legacy chatView.is-open without OS foreground', async () => {
    resetOsPageBridgeForTests();
    const { isChatAppForeground } = await import('../../src/ui/chat-mount.ts');

    assert.equal(isChatAppForeground(), true);
  });

  test('Email foreground routes to the assistant mount and registered composer only while open', async () => {
    const {
      getActiveChatMountElement,
      isEmailAssistantForeground,
    } = await import('../../src/ui/chat-mount.ts');
    const {
      getActiveComposerSurface,
      registerComposerSurface,
    } = await import('../../src/ui/composer-surface.ts');
    const { getChatScrollRoot } = await import('../../src/ui/chat-scroll.ts');
    const emailInput = document.getElementById('emailAssistantInput') as HTMLTextAreaElement;
    const emailSend = document.getElementById('emailAssistantSendBtn') as HTMLButtonElement;
    registerComposerSurface('email', { inputEl: emailInput, sendBtnEl: emailSend });

    launchInstance('email');

    assert.equal(isEmailAssistantForeground(), true);
    assert.equal(getActiveChatMountElement().id, 'emailAssistantMessageCol');
    assert.equal(getActiveComposerSurface().inputEl?.id, 'emailAssistantInput');
    assert.equal(getChatScrollRoot()?.className, 'email-assistant-scroll');

    const dock = document.querySelector<HTMLElement>('.email-assistant-dock');
    dock?.classList.remove('is-open');
    dock?.setAttribute('aria-hidden', 'true');
    assert.equal(isEmailAssistantForeground(), false);
    registerComposerSurface('email', { inputEl: null, sendBtnEl: null });
  });
});
