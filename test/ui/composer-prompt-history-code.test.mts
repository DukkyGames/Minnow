/**
 * Code composer (#msgInput) ArrowUp prompt history via initComposerInput (MIN-459).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Window } from 'happy-dom';

const { __resetComposerPromptHistoryForTests } = await import(
  '../../src/ui/composer-prompt-history.ts'
);
const { initComposerInput } = await import('../../src/ui/input.ts');
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);

function setupHappyDom(): void {
  const window = new Window();
  const g = globalThis as typeof globalThis & {
    window: Window;
    document: Document;
    HTMLElement: typeof HTMLElement;
    HTMLTextAreaElement: typeof HTMLTextAreaElement;
    KeyboardEvent: typeof KeyboardEvent;
    Event: typeof Event;
  };
  g.window = window as unknown as Window & typeof globalThis.window;
  g.document = window.document;
  g.HTMLElement = window.HTMLElement;
  g.HTMLTextAreaElement = window.HTMLTextAreaElement;
  g.KeyboardEvent = window.KeyboardEvent;
  g.Event = window.Event;
}

function mountCodeComposer(): HTMLTextAreaElement {
  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);
  return input;
}

function dispatchArrowUp(input: HTMLTextAreaElement): void {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
  );
}

describe('code composer prompt history wiring (MIN-459)', () => {
  it('initComposerInput wires ArrowUp recall on #msgInput', () => {
    setupHappyDom();
    __resetComposerPromptHistoryForTests();

    const chat = createEmptyChatObject('model');
    chat.history = [
      { role: 'user', content: 'first prompt' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second prompt' },
    ];
    setSessionStateForTests({
      activeId: chat.id,
      chats: [chat],
      lastActiveChatIdByWorkspace: {},
    });

    const input = mountCodeComposer();
    initComposerInput(input);

    input.value = '';
    input.setSelectionRange(0, 0);
    dispatchArrowUp(input);

    assert.equal(input.value, 'second prompt');
    assert.equal(input.dataset.composerKeydownWired, '1');
  });

  it('initComposerInput wiring is idempotent', () => {
    setupHappyDom();

    const input = mountCodeComposer();
    initComposerInput(input);
    initComposerInput(input);

    assert.equal(input.dataset.composerKeydownWired, '1');
  });
});
