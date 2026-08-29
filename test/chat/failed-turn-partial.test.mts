/**
 * A failed turn keeps what it already streamed (partial prose + reasoning).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resolveFailedTurnPartialRow } from '../../src/tools/turn-continuation.ts';
import { markMessageFailed } from '../../src/ui/stopped-affordance.ts';
import { appendFailedTurnRecoveryActions } from '../../src/ui/failed-turn-recovery-actions.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
}

describe('resolveFailedTurnPartialRow', () => {
  test('keeps partial prose and reasoning on a failed row', () => {
    const row = resolveFailedTurnPartialRow({
      partialText: 'Here is what I found so f',
      thinking: ['Checking the config first.', '  '],
    });
    assert.deepEqual(row, {
      role: 'assistant',
      content: 'Here is what I found so f',
      failed: true,
      thinking: ['Checking the config first.'],
    });
  });

  test('falls back to reasoning when no prose was streamed', () => {
    const row = resolveFailedTurnPartialRow({
      partialText: '   ',
      thinking: ['First thought', 'Second thought'],
    });
    assert.equal(row?.failed, true);
    assert.equal(row?.content, 'First thought\n\nSecond thought');
  });

  test('stores nothing when the turn produced no output', () => {
    assert.equal(
      resolveFailedTurnPartialRow({ partialText: '  ', thinking: [] }),
      null,
    );
    assert.equal(resolveFailedTurnPartialRow({ partialText: '', thinking: ['']}), null);
  });

  test('stores nothing when the only partial output was tool-call markup', () => {
    const row = resolveFailedTurnPartialRow({
      partialText: '<tool_call>{"name":"read_file","arguments":{}}</tool_call>',
      thinking: [],
    });
    assert.equal(row, null);
  });

  test('keeps prose that accompanied a tool call', () => {
    const row = resolveFailedTurnPartialRow({
      partialText: 'Let me look at the file.\n<tool_call>{"name":"read_file","arguments":{}}</tool_call>',
      thinking: [],
    });
    assert.equal(row?.content, 'Let me look at the file.');
    assert.equal(row?.failed, true);
  });
});

describe('failed assistant affordance', () => {
  test('markMessageFailed adds chip to assistant row', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const label = document.createElement('div');
    label.className = 'msg-label';
    wrap.appendChild(label);

    markMessageFailed(wrap);

    assert.ok(wrap.classList.contains('msg--failed'));
    assert.equal(
      wrap.querySelector('.msg-failed-chip')?.textContent,
      'Partial reply — turn failed',
    );
  });

  test('markMessageFailed is idempotent across a re-render', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';

    markMessageFailed(wrap);
    markMessageFailed(wrap);

    assert.equal(wrap.querySelectorAll('.msg-failed-chip').length, 1);
  });

  test('markMessageFailed with recovery exposes Continue and Clear', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const label = document.createElement('div');
    label.className = 'msg-label';
    wrap.appendChild(label);

    markMessageFailed(wrap, { chatId: 'chat_1', forkHistoryIndex: 2 });

    const buttons = [...wrap.querySelectorAll('button')].map((b) => b.textContent);
    assert.deepEqual(buttons, ['Continue', 'Clear']);
    assert.equal(wrap.querySelectorAll('.msg-error-recover-actions').length, 1);
  });
});

describe('failed-turn recovery chrome', () => {
  test('error bubble offers Continue and Clear instead of rewind-and-retry', async () => {
    setupDom();
    const { setAssistantErrorBubbleWithRecovery } = await import('../../src/ui/messages.ts');
    const bubble = document.createElement('div');
    setAssistantErrorBubbleWithRecovery(bubble, 'Could not complete this reply: network error', {
      chatId: 'chat_1',
      forkHistoryIndex: 2,
    });

    const labels = [...bubble.querySelectorAll('button')].map((b) => b.textContent);
    assert.deepEqual(labels, ['Continue', 'Clear']);
    assert.equal(bubble.textContent?.includes('Clear last failed turn'), false);
    assert.match(bubble.textContent ?? '', /network error/);
  });

  test('appendFailedTurnRecoveryActions is idempotent', () => {
    setupDom();
    const host = document.createElement('div');
    const recovery = { chatId: 'chat_1', forkHistoryIndex: 0 };
    appendFailedTurnRecoveryActions(host, recovery);
    appendFailedTurnRecoveryActions(host, recovery);
    assert.equal(host.querySelectorAll('.msg-error-recover-actions').length, 1);
  });
});
