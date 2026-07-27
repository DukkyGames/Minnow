import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const {
  clearComposerAfterSend,
  persistComposerDraftOnChat,
} = await import('../../src/ui/composer-draft.ts');

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';

function setupComposerInput(): HTMLTextAreaElement {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);
  return input;
}

describe('clearComposerAfterSend', () => {
  afterEach(() => {
    setSessionStateForTests(null);
    document.body.replaceChildren();
  });

  test('clears persisted draft and textarea after send', () => {
    const chat = createEmptyChatObject(FIXED_CHAT_ID);
    persistComposerDraftOnChat(chat, 'hello world');
    const input = setupComposerInput();
    input.value = 'hello world';

    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    clearComposerAfterSend(chat, input);

    assert.equal(chat.composerDraft, undefined);
    assert.equal(input.value, '');
  });
});
