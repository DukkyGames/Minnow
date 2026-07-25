/**
 * Onboarding guide step: ask_question embed host routing.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import {
  ONBOARDING_GUIDE_CHAT_COL_ID,
  ONBOARDING_GUIDE_QUESTIONS_ID,
  registerOnboardingGuideChatId,
  resolveOnboardingGuideQuestionHost,
  isOnboardingGuideSuppressingChatDom,
} from '../../src/onboarding/guide-questions.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

describe('onboarding guide ask_question host', () => {
  afterEach(() => {
    registerOnboardingGuideChatId(null);
    setSessionStateForTests(null);
  });

  test('resolveOnboardingGuideQuestionHost exposes slot during Meet Minnow step', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    chat.id = '11111111-1111-1111-1111-111111111111';
    chat.modeId = 'onboarding';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    registerOnboardingGuideChatId(chat.id);

    assert.equal(resolveOnboardingGuideQuestionHost(chat.id), null);

    document.body.innerHTML = `
      <div id="${ONBOARDING_GUIDE_CHAT_COL_ID}"></div>
      <div id="${ONBOARDING_GUIDE_QUESTIONS_ID}" class="mn-onboarding-guide__questions" hidden></div>
    `;

    const host = resolveOnboardingGuideQuestionHost(chat.id);
    assert.ok(host, 'guide step should expose onboarding questions host');
    assert.equal(host.id, ONBOARDING_GUIDE_QUESTIONS_ID);
    assert.equal(host.hidden, false);
    assert.equal(isOnboardingGuideSuppressingChatDom(chat.id), true);

    window.close();
  });
});
