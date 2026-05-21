import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { setChatFetchAbort } from '../../src/app-state.ts';
import { stopGeneration } from '../../src/chat/stop-generation.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';

function seedActiveChat(): void {
  const chat = createEmptyChatObject('m1');
  chat.id = FIXED_CHAT_ID;
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
}

describe('stopGeneration', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.performance = window.performance;
  });

  afterEach(() => {
    setSessionStateForTests(null);
    setChatFetchAbort(null);
  });

  test('calls abort() when chatFetchAbort is set', () => {
    seedActiveChat();
    let aborted = false;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    setChatFetchAbort(controller);
    stopGeneration();
    assert.equal(aborted, true);
  });

  test('no-op when chatFetchAbort is null', () => {
    seedActiveChat();
    setChatFetchAbort(null);
    assert.doesNotThrow(() => stopGeneration());
  });
});
