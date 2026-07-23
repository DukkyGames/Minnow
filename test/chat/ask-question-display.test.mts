/**
 * ask_question display context: questions stick to the owning chat surface.
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
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="mainColumn">
      <div id="chatArea" class="chat-area"></div>
      <div id="questionHost" class="question-host" hidden></div>
    </div>
    <main id="chatView" class="chat-app-page">
      <div id="chatAppQuestionHost" class="question-host" hidden></div>
    </main>
    <div id="globalQuestionHost" class="question-host question-host--global" hidden></div>
    <div id="desktopComposerRoot" class="mn-os-desktop-composer">
      <div id="desktopQuestionHost" class="question-host" hidden></div>
    </div>
    <aside class="email-assistant-dock is-open" aria-hidden="false">
      <div id="emailAssistantQuestionHost" class="question-host" hidden></div>
    </aside>
  `;
}

function seedChat(chatId: string): void {
  const chat = createEmptyChatObject('');
  chat.id = chatId;
  setSessionStateForTests({
    version: 5,
    activeId: chatId,
    sidebarCollapsed: false,
    chats: [chat],
  });
}

describe('ask-question-display', () => {
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
    seedChat('chat-a');
  });

  afterEach(() => {
    resetDesktopStateForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    setSessionStateForTests(null);
  });

  test('isAskQuestionDomVisible is false for inactive chat on Code foreground', async () => {
    const chatA = createEmptyChatObject('');
    chatA.id = 'chat-a';
    const chatB = createEmptyChatObject('');
    chatB.id = 'chat-b';
    setSessionStateForTests({
      version: 5,
      activeId: 'chat-a',
      sidebarCollapsed: false,
      chats: [chatA, chatB],
    });

    const { isAskQuestionDomVisible } = await import('../../src/chat/ask-question-display.ts');
    launchInstance('code');

    assert.equal(isAskQuestionDomVisible('chat-a'), true);
    assert.equal(isAskQuestionDomVisible('chat-b'), false);
  });

  test('isAskQuestionDomVisible is false when Brain covers the shell', async () => {
    const { isAskQuestionDomVisible } = await import('../../src/chat/ask-question-display.ts');
    launchInstance('brain');

    assert.equal(isAskQuestionDomVisible('chat-a'), false);
  });

  test('isAskQuestionDomVisible is true for desktop chat', async () => {
    setDesktopStateForTests('chatActive');
    const { isAskQuestionDomVisible } = await import('../../src/chat/ask-question-display.ts');

    assert.equal(isAskQuestionDomVisible('chat-a'), true);
  });

  test('Email questions are visible only for an Email-scoped chat with an open dock', async () => {
    const { isAskQuestionDomVisible } = await import('../../src/chat/ask-question-display.ts');
    const { sessionState } = await import('../../src/state/sessions.ts');
    const chat = sessionState?.chats[0];
    assert.ok(chat);
    chat.appScope = 'email';
    chat.modeId = 'email';
    launchInstance('email');

    assert.equal(isAskQuestionDomVisible('chat-a'), true);

    const dock = document.querySelector<HTMLElement>('.email-assistant-dock');
    dock?.classList.remove('is-open');
    dock?.setAttribute('aria-hidden', 'true');
    assert.equal(isAskQuestionDomVisible('chat-a'), false);
  });

  test('waitForAskQuestionDisplayContext resolves when chat becomes active surface', async () => {
    const chatA = createEmptyChatObject('');
    chatA.id = 'chat-a';
    const chatB = createEmptyChatObject('');
    chatB.id = 'chat-b';
    setSessionStateForTests({
      version: 5,
      activeId: 'chat-a',
      sidebarCollapsed: false,
      chats: [chatA, chatB],
    });

    const { isAskQuestionDomVisible, waitForAskQuestionDisplayContext, notifyAskQuestionDisplayContextChanged } =
      await import('../../src/chat/ask-question-display.ts');
    launchInstance('brain');
    assert.equal(isAskQuestionDomVisible('chat-b'), false);

    const { sessionState } = await import('../../src/state/sessions.ts');
    const waiter = waitForAskQuestionDisplayContext('chat-b');
    launchInstance('code');
    if (sessionState) sessionState.activeId = 'chat-b';
    notifyAskQuestionDisplayContextChanged();

    await waiter;
    assert.equal(isAskQuestionDomVisible('chat-b'), true);
  });

  test('waitForAskQuestionDisplayContext resolves when code overview overlay closes', async () => {
    const { isAskQuestionDomVisible, waitForAskQuestionDisplayContext, notifyAskQuestionDisplayContextChanged } =
      await import('../../src/chat/ask-question-display.ts');
    launchInstance('code');

    const overviewRoot = document.createElement('div');
    overviewRoot.id = 'codeOverviewRoot';
    document.getElementById('chatArea')?.appendChild(overviewRoot);
    document.getElementById('chatArea')?.classList.add('chat-area--code-overview');
    assert.equal(isAskQuestionDomVisible('chat-a'), false);

    const waiter = waitForAskQuestionDisplayContext('chat-a');
    overviewRoot.remove();
    document.getElementById('chatArea')?.classList.remove('chat-area--code-overview');
    notifyAskQuestionDisplayContextChanged();

    await waiter;
    assert.equal(isAskQuestionDomVisible('chat-a'), true);
  });
});
