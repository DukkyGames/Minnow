/**
 * P8-F — sub-agent card states as a view of derived store state (MIN-759).
 *
 * Queued / running / complete / start-error counter. Reuses existing
 * `.sub-agent-card` chrome — no second visual language.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';

const { upsertSubAgentCardForRun, clearSubAgentCardDomRegistry } = await import(
  '../../src/ui/sub-agent-cards.ts',
);
const { adoptSubAgentRunForTests, resetSubAgentOrchestrator } = await import(
  '../../src/agents/orchestrator.ts',
);
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts',
);

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

function sampleRun(chatId: string, extra: Partial<SubAgentRun> = {}): SubAgentRun {
  return {
    runId: extra.runId ?? '22222222-2222-2222-2222-222222222222',
    type: 'explore',
    task: 'List files under src/',
    status: extra.status ?? 'running',
    parentChatId: chatId,
    parentToolCallId: null,
    parentTurnId: 'turn-1',
    summary: extra.summary ?? '',
    error: extra.error ?? null,
    startedAt: '2026-05-20T12:00:00.000Z',
    endedAt: extra.endedAt ?? null,
    toolTurns: extra.toolTurns ?? 0,
    cancelled: extra.status === 'cancelled',
    messages: [],
    ...extra,
  };
}

describe('sub-agent card states (P8-F view)', { concurrency: false }, () => {
  afterEach(() => {
    clearSubAgentCardDomRegistry();
    resetSubAgentOrchestrator();
    setSessionStateForTests(null);
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  function mount(run: SubAgentRun) {
    setupCodeDom();
    const chat = createEmptyChatObject('');
    chat.id = run.parentChatId as string;
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    adoptSubAgentRunForTests(run);
    return upsertSubAgentCardForRun(run, chat.id);
  }

  test('queued card shows queued state', () => {
    const el = mount(sampleRun('chat-queued', { status: 'queued', runId: 'run-queued' }));
    assert.ok(el);
    assert.equal(el.dataset.status, 'queued');
    assert.ok(el.classList.contains('sub-agent-card--active'));
    assert.ok(el.textContent?.includes('Queued'));
  });

  test('running card shows working state', () => {
    const el = mount(sampleRun('chat-running', { status: 'running', runId: 'run-running' }));
    assert.ok(el);
    assert.equal(el.dataset.status, 'running');
    assert.ok(el.classList.contains('sub-agent-card--active'));
    assert.ok(el.textContent?.includes('Working') || el.textContent?.includes('Generating'));
  });

  test('completed card shows done state', () => {
    const el = mount(
      sampleRun('chat-done', {
        status: 'completed',
        runId: 'run-done',
        summary: 'Found three files.',
        endedAt: '2026-05-20T12:01:00.000Z',
      }),
    );
    assert.ok(el);
    assert.equal(el.dataset.status, 'completed');
    assert.equal(el.classList.contains('sub-agent-card--active'), false);
    assert.ok(el.textContent?.includes('Done'));
    assert.ok(el.textContent?.includes('Found three files'));
  });

  test('start-error is a counter on the card, not a toast per tick', () => {
    const el = mount(
      sampleRun('chat-err', {
        status: 'running',
        runId: 'run-err',
        startError: {
          message: 'no model bound for this attempt',
          consecutive: 4,
        },
      }),
    );
    assert.ok(el);
    assert.ok(el.querySelector('.sub-agent-card__error'));
    assert.ok(el.textContent?.includes('no model bound for this attempt'));
    assert.ok(el.textContent?.includes('(4)'));
    assert.equal(document.querySelectorAll('.toast').length, 0);
  });
});
