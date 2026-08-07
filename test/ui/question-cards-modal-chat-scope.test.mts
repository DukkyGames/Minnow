/**
 * ask_question strip parks when leaving the owning chat and restores on return.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
} from '../helpers/legacy-desktop-state.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  installHappyDomGlobals,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

/** @type {import('happy-dom').Window | undefined} */
let win: import('happy-dom').Window | undefined;

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="mainColumn" class="main-column">
      <div id="chatArea" class="chat-area"></div>
      <div id="questionHost" class="question-host" hidden></div>
      <textarea id="msgInput"></textarea>
      <button id="sendBtn"></button>
    </div>
    <div id="desktopComposerRoot" class="mn-os-desktop-composer">
      <div id="desktopQuestionHost" class="question-host" hidden></div>
      <textarea id="desktopInput"></textarea>
      <button id="desktopSendBtn"></button>
    </div>
  `;
}

describe('question-cards-modal chat scope', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    installHappyDomGlobals(win);
    setupDom(win);
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();

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
    launchInstance('code');
  });

  afterEach(async () => {
    const { resetQuestionCardsModalForTests } = await import(
      '../../src/ui/question-cards-modal.ts'
    );
    resetQuestionCardsModalForTests();
    resetDesktopStateForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    setSessionStateForTests(null);
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('parks strip when switching away from owning chat', async () => {
    const {
      showQuestionCardsModal,
      syncAskQuestionModalOnChatSwitch,
      isAskQuestionModalOpenForChat,
    } = await import('../../src/ui/question-cards-modal.ts');

    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Pick one',
            options: [{ id: 'a', label: 'Alpha' }],
          },
        ],
      },
      {},
      { chatId: 'chat-a' },
    );

    const host = document.getElementById('questionHost');
    assert.ok(host?.querySelector('.question-cards-panel'));
    assert.equal(host?.hidden, false);

    syncAskQuestionModalOnChatSwitch('chat-a', 'chat-b');
    assert.equal(host?.hidden, true);
    assert.equal(isAskQuestionModalOpenForChat('chat-a'), true);

    const closeBtn = host?.querySelector('.question-cards-icon-btn') as HTMLButtonElement;
    closeBtn?.click();
    const result = await modalPromise;
    assert.equal(result.status, 'cancelled');
  });

  test('unparks strip when returning to owning chat', async () => {
    const {
      showQuestionCardsModal,
      syncAskQuestionModalOnChatSwitch,
    } = await import('../../src/ui/question-cards-modal.ts');

    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Pick one',
            options: [{ id: 'a', label: 'Alpha' }],
          },
        ],
      },
      {},
      { chatId: 'chat-a' },
    );

    syncAskQuestionModalOnChatSwitch('chat-a', 'chat-b');
    const host = document.getElementById('questionHost');
    assert.equal(host?.hidden, true);

    syncAskQuestionModalOnChatSwitch('chat-b', 'chat-a');
    assert.equal(host?.hidden, false);
    assert.ok(host?.querySelector('.question-cards-panel'));

    const closeBtn = host?.querySelector('.question-cards-icon-btn') as HTMLButtonElement;
    closeBtn?.click();
    await modalPromise;
  });

  test('unparks strip when code overview overlay closes', async () => {
    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const { notifyAskQuestionDisplayContextChanged } = await import(
      '../../src/chat/ask-question-display.ts'
    );

    const overviewRoot = document.createElement('div');
    overviewRoot.id = 'codeOverviewRoot';
    document.getElementById('chatArea')?.appendChild(overviewRoot);
    document.getElementById('chatArea')?.classList.add('chat-area--code-overview');

    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Pick one',
            options: [{ id: 'a', label: 'Alpha' }],
          },
        ],
      },
      {},
      { chatId: 'chat-a' },
    );

    const host = document.getElementById('questionHost');
    assert.equal(host?.hidden, true);

    overviewRoot.remove();
    document.getElementById('chatArea')?.classList.remove('chat-area--code-overview');
    notifyAskQuestionDisplayContextChanged();

    assert.equal(host?.hidden, false);
    assert.ok(host?.querySelector('.question-cards-panel'));

    const closeBtn = host?.querySelector('.question-cards-icon-btn') as HTMLButtonElement;
    closeBtn?.click();
    await modalPromise;
  });
});
