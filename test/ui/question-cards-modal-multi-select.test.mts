/**
 * Multi-select ask_question cards must not auto-submit after the first checkbox.
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
    <div id="mainColumn" class="main-column">
      <div id="questionHost" class="question-host"></div>
      <textarea id="msgInput"></textarea>
      <button id="sendBtn"></button>
    </div>
    <div id="orchestratePlanScreenQuestions" class="question-host" hidden></div>
  `;
}

describe('question-cards-modal multi-select', () => {
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
    chat.id = 'chat-sp';
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

  test('embedded click-all-that-apply waits for Continue after multiple picks', async () => {
    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const host = document.getElementById('orchestratePlanScreenQuestions');
    assert.ok(host);

    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Which auth providers? (Click all that apply)',
            options: [
              { id: 'google', label: 'Google' },
              { id: 'github', label: 'GitHub' },
              { id: 'email', label: 'Email' },
            ],
          },
        ],
      },
      {},
      { host: host!, embedded: true, chatId: 'chat-sp' },
    );

    const checkboxes = host?.querySelectorAll('input[type="checkbox"]');
    assert.ok(checkboxes && checkboxes.length >= 2, 'expected checkbox inputs for multi-select');

    (host?.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement).click();
    let settled = false;
    void modalPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false, 'first checkbox must not auto-submit');

    (host?.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click();
    await Promise.resolve();
    assert.equal(settled, false, 'second checkbox must not auto-submit');

    const submit = host?.querySelector('.question-cards-submit') as HTMLButtonElement | null;
    assert.ok(submit);
    assert.equal(submit.hidden, false);
    assert.equal(submit.disabled, false);
    submit.click();

    const result = await modalPromise;
    assert.equal(result.status, 'answered');
    if (result.status === 'answered') {
      assert.deepEqual(result.answers[0].selectedIds, ['google', 'github']);
    }
  });

  test('single-select still auto-submits on one radio pick', async () => {
    const { showQuestionCardsModal } = await import('../../src/ui/question-cards-modal.ts');
    const host = document.getElementById('questionHost');
    assert.ok(host);

    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Pick one scope',
            options: [
              { id: 'small', label: 'Small' },
              { id: 'large', label: 'Large' },
            ],
          },
        ],
      },
      {},
      { chatId: 'chat-sp' },
    );

    const radio = host?.querySelector('input[type="radio"]') as HTMLInputElement | null;
    assert.ok(radio);
    radio.click();

    const result = await modalPromise;
    assert.equal(result.status, 'answered');
    if (result.status === 'answered') {
      assert.deepEqual(result.answers[0].selectedIds, ['small']);
    }
  });
});
