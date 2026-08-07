import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetDesktopStateForTests,
} from '../helpers/legacy-desktop-state.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';

const { upsertSubAgentCardForRun, clearSubAgentCardDomRegistry } = await import(
  '../../src/ui/sub-agent-cards.ts',
);
const { setSessionStateForTests, createEmptyChatObject, getActiveChat } = await import(
  '../../src/state/sessions.ts',
);
const { renderHub, teardownHub } = await import('../../src/ui/hub.ts');

function setupCodeDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  document.body.innerHTML = `
    <div id="mainColumn">
      <div id="chatArea"></div>
      <div class="input-bar">
        <textarea id="msgInput"></textarea>
        <div id="modeSelector"></div>
      </div>
    </div>
  `;
  return window;
}

const sampleRun = (chatId: string) => ({
  runId: '22222222-2222-2222-2222-222222222222',
  type: 'explore',
  task: 'List files under src/',
  status: 'running' as const,
  parentChatId: chatId,
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
});

describe('sub-agent cards', { concurrency: false }, () => {
  afterEach(() => {
    teardownHub();
    setSessionStateForTests(null);
    resetDesktopStateForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  test('upsertSubAgentCardForRun mounts a card for the active chat', () => {
    setupCodeDom();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-sub-1';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const el = upsertSubAgentCardForRun(sampleRun(chat.id), chat.id);
    assert.ok(el);
    assert.ok(el.classList.contains('sub-agent-card--active'));
    assert.ok(el.textContent?.includes('Working'));
    assert.ok(el.textContent?.includes('explore'));
    assert.ok(el.textContent?.includes('List files'));
    assert.equal(document.getElementById('chatArea')?.querySelector('.sub-agent-card'), el);

    clearSubAgentCardDomRegistry();
  });

  test('upsertSubAgentCardForRun shows live phase on the badge and subtitle', () => {
    setupCodeDom();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-sub-live';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const el = upsertSubAgentCardForRun(
      {
        ...sampleRun(chat.id),
        livePhase: 'thinking',
        livePartialReasoning: 'Checking routes…',
      },
      chat.id,
    );
    assert.ok(el);
    assert.ok(el.textContent?.includes('Thinking'));
    assert.ok(el.textContent?.includes('Thinking…'));

    clearSubAgentCardDomRegistry();
  });

  test('upsertSubAgentCardForRun skips the Vibe hub empty-chat landing', () => {
    setupCodeDom();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-hub-sub';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderHub(chat);
    const el = upsertSubAgentCardForRun(sampleRun(chat.id), chat.id);
    assert.equal(el, null);
    assert.equal(document.getElementById('chatArea')?.querySelector('.sub-agent-card'), null);

    clearSubAgentCardDomRegistry();
  });
});
