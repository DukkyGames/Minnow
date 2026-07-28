/**
 * ask_question strip traps focus and restores it after close.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
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
    <button id="beforeBtn" type="button">Before</button>
    <div id="mainColumn" class="main-column">
      <div id="questionHost" class="question-host" hidden></div>
      <textarea id="msgInput"></textarea>
      <button id="sendBtn"></button>
    </div>
    <button id="afterBtn" type="button">After</button>
  `;
}

describe('question-cards-modal focus trap', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    installHappyDomGlobals(win);
    setupDom(win);
    win.globalThis.requestAnimationFrame = (cb: () => void) => {
      cb();
      return 0;
    };
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-focus';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    launchInstance('code');
  });

  afterEach(async () => {
    const { resetQuestionCardsModalForTests } = await import(
      '../../src/ui/question-cards-modal.ts'
    );
    resetQuestionCardsModalForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    setSessionStateForTests(null);
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('panel is modal dialog with labelled prompt', async () => {
    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const promise = showQuestionCardsModal({
      questions: [
        {
          id: 'q1',
          prompt: 'Pick one',
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ],
        },
      ],
    });

    const panel = win!.document.querySelector('.question-cards-panel');
    assert.ok(panel);
    assert.equal(panel?.getAttribute('role'), 'dialog');
    assert.equal(panel?.getAttribute('aria-modal'), 'true');
    assert.ok(panel?.getAttribute('aria-labelledby'));

    const { forceCloseAskQuestionModal } = await import('../../src/ui/question-cards-modal.ts');
    forceCloseAskQuestionModal();
    await promise;
  });

  test('Tab cycles inside panel and close restores prior focus', async () => {
    const beforeBtn = win!.document.getElementById('beforeBtn') as HTMLButtonElement;
    beforeBtn.focus();
    assert.equal(win!.document.activeElement, beforeBtn);

    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const promise = showQuestionCardsModal({
      questions: [
        {
          id: 'q1',
          prompt: 'Pick one',
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ],
        },
      ],
    });

    const panel = win!.document.querySelector('.question-cards-panel') as HTMLElement;
    const closeBtn = panel.querySelector(
      '.question-cards-icon-btn',
    ) as HTMLButtonElement;
    assert.ok(closeBtn);

    closeBtn.focus();
    assert.equal(win!.document.activeElement, closeBtn);

    const tabEvent = new win!.KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(tabEvent);
    assert.ok(tabEvent.defaultPrevented);
    assert.notEqual(win!.document.activeElement, closeBtn);

    closeBtn.click();
    const result = await promise;
    assert.equal(result.status, 'cancelled');
    assert.equal(win!.document.activeElement, beforeBtn);
  });

  test('focusin outside panel returns focus to first answer control', async () => {
    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const promise = showQuestionCardsModal({
      questions: [
        {
          id: 'q1',
          prompt: 'Pick one',
          options: [{ id: 'a', label: 'Alpha' }],
        },
      ],
    });

    const afterBtn = win!.document.getElementById('afterBtn') as HTMLButtonElement;
    afterBtn.focus();

    const panel = win!.document.querySelector('.question-cards-panel') as HTMLElement;
    const trapped = panel.querySelector(
      '.question-cards-options input',
    ) as HTMLInputElement;
    assert.ok(trapped);
    assert.equal(win!.document.activeElement, trapped);

    const { forceCloseAskQuestionModal } = await import('../../src/ui/question-cards-modal.ts');
    forceCloseAskQuestionModal();
    await promise;
  });
});
