/**
 * Desktop session rail must park ask_question UI when switching chats.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  installHappyDomGlobals,
  teardownHappyDomAsync,
} from './dom-helpers.mts';

/** @type {import('happy-dom').Window | undefined} */
let win: import('happy-dom').Window | undefined;

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="desktopChatCol" class="mn-os-chat-transcript-col"></div>
    <div id="desktopComposerRoot" class="mn-os-desktop-composer">
      <div id="desktopQuestionHost" class="question-host" hidden></div>
      <textarea id="desktopInput"></textarea>
      <button id="desktopSendBtn"></button>
    </div>
    <div id="globalQuestionHost" class="question-host question-host--global" hidden></div>
  `;
}

describe('desktop chat session switch', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    installHappyDomGlobals(win);
    setupDom(win);
    resetOsPageBridgeForTests();
    initOsPageBridge();
    setDesktopStateForTests('chatActive');

    const chatA = createEmptyChatObject('');
    chatA.id = 'chat-a';
    chatA.modeId = 'desktop';
    const chatB = createEmptyChatObject('');
    chatB.id = 'chat-b';
    chatB.modeId = 'desktop';
    setSessionStateForTests({
      version: 5,
      activeId: 'chat-a',
      sidebarCollapsed: false,
      chats: [chatA, chatB],
    });
  });

  afterEach(async () => {
    const { resetQuestionCardsModalForTests } = await import(
      '../../src/ui/question-cards-modal.ts'
    );
    resetQuestionCardsModalForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    setSessionStateForTests(null);
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('activateDesktopChatSession parks ask_question when switching away', async () => {
    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const { activateDesktopChatSession } = await import('../../src/os/desktop-chat.ts');

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

    const host = document.getElementById('desktopQuestionHost');
    assert.ok(host?.querySelector('.question-cards-panel'));
    assert.equal(host?.hidden, false);

    activateDesktopChatSession('chat-b');
    assert.equal(host?.hidden, true);

    const closeBtn = host?.querySelector('.question-cards-icon-btn') as HTMLButtonElement;
    closeBtn?.click();
    const result = await modalPromise;
    assert.equal(result.status, 'cancelled');
  });

  test('activateDesktopChatSession unparks ask_question when returning to owning chat', async () => {
    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const { activateDesktopChatSession } = await import('../../src/os/desktop-chat.ts');

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

    const host = document.getElementById('desktopQuestionHost');
    activateDesktopChatSession('chat-b');
    assert.equal(host?.hidden, true);

    activateDesktopChatSession('chat-a');
    assert.equal(host?.hidden, false);
    assert.ok(host?.querySelector('.question-cards-panel'));

    const closeBtn = host?.querySelector('.question-cards-icon-btn') as HTMLButtonElement;
    closeBtn?.click();
    await modalPromise;
  });
});
