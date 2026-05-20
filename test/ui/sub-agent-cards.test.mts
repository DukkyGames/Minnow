import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts',
);
const { upsertSubAgentCardForRun, clearSubAgentCardDomRegistry } = await import(
  '../../src/ui/sub-agent-cards.ts',
);

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);
  return window;
}

describe('sub-agent cards', { concurrency: false }, () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('upsertSubAgentCardForRun mounts a card for the active chat', () => {
    setupDom();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-sub-1';
    setSessionStateForTests({
      version: 1,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const run = {
      runId: '22222222-2222-2222-2222-222222222222',
      type: 'explore',
      task: 'List files under src/',
      status: 'running',
      parentChatId: chat.id,
      parentToolCallId: null,
      parentTurnId: 'turn-1',
      summary: '',
      error: null,
      startedAt: '2026-05-20T12:00:00.000Z',
      endedAt: null,
      toolTurns: 0,
      cancelled: false,
      messages: [],
      liveNestedToolCalls: 1,
    };

    const el = upsertSubAgentCardForRun(run, chat.id);
    assert.ok(el);
    assert.ok(el.classList.contains('sub-agent-card--active'));
    assert.ok(el.textContent?.includes('Working'));
    assert.ok(el.textContent?.includes('explore'));
    assert.ok(el.textContent?.includes('List files'));

    clearSubAgentCardDomRegistry();
  });
});
