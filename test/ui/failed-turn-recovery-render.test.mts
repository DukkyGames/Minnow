/**
 * renderChatFromHistory paints Continue / Clear on a tail failed assistant (MIN-666).
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { renderChatFromHistory } from '../../src/ui/messages.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Message } from '../../src/types.ts';

function mountCodeChatArea(): HTMLElement {
  document.body.replaceChildren();
  const viewport = document.createElement('div');
  viewport.className = 'chat-viewport';
  const area = document.createElement('main');
  area.id = 'chatArea';
  viewport.appendChild(area);
  document.body.appendChild(viewport);
  document.body.appendChild(
    Object.assign(document.createElement('div'), { id: 'mainColumn' }),
  );
  return area;
}

describe('failed-turn recovery render', () => {
  afterEach(() => {
    document.body.replaceChildren();
    setSessionStateForTests(null);
  });

  test('tail failed row keeps earlier turns and offers Continue and Clear', () => {
    const area = mountCodeChatArea();

    const chat = createEmptyChatObject('m1', '/tmp/ws');
    chat.modeId = 'general';
    const history: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there.' },
      { role: 'user', content: 'now do X' },
      { role: 'assistant', content: 'Partial answer befo', failed: true },
    ];
    chat.history = history;

    setSessionStateForTests({
      version: 6,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderChatFromHistory(chat);

    const text = area.textContent ?? '';
    assert.match(text, /hello/);
    assert.match(text, /Hi there/);
    assert.match(text, /now do X/);
    assert.match(text, /Partial answer befo/);

    const failed = area.querySelector('.msg.assistant.msg--failed');
    assert.ok(failed, 'failed assistant row should render');
    const labels = [...failed.querySelectorAll('.msg-error-recover-btn')].map(
      (b) => b.textContent,
    );
    assert.deepEqual(labels, ['Continue', 'Clear']);
    assert.ok(
      failed.classList.contains('msg--has-actions'),
      'failed row keeps the ⋮ menu; CSS must inset Continue/Clear so they are not under it',
    );

    const earlierAssistant = [...area.querySelectorAll('.msg.assistant')].find(
      (el) => !el.classList.contains('msg--failed'),
    );
    assert.ok(earlierAssistant);
    assert.match(earlierAssistant?.textContent ?? '', /Hi there/);
  });

  test('Clear drops the failed assistant and keeps the user prompt and earlier turns', async () => {
    const area = mountCodeChatArea();

    const chat = createEmptyChatObject('m1', '/tmp/ws');
    chat.modeId = 'general';
    chat.history = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there.' },
      { role: 'user', content: 'now do X' },
      { role: 'assistant', content: 'Partial answer befo', failed: true },
    ];

    setSessionStateForTests({
      version: 6,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderChatFromHistory(chat);
    const clearBtn = area.querySelector(
      '.msg-error-recover-btn:not(.msg-error-recover-btn--continue)',
    ) as HTMLButtonElement | null;
    assert.ok(clearBtn);

    // Clicks must not bubble to the message row (that would open ⋮ / capture menus).
    const failedRow = area.querySelector('.msg.assistant.msg--failed');
    assert.ok(failedRow);
    let rowClicks = 0;
    failedRow.addEventListener('click', () => {
      rowClicks += 1;
    });
    clearBtn.click();
    assert.equal(rowClicks, 0);

    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (chat.history.length === 3 && !area.querySelector('.msg--failed')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.equal(chat.history.length, 3);
    assert.equal(chat.history[0].content, 'hello');
    assert.equal(chat.history[1].content, 'Hi there.');
    assert.equal(chat.history[2].content, 'now do X');
    assert.equal(
      chat.history.some((m) => m.role === 'assistant' && 'failed' in m && m.failed),
      false,
    );
    assert.equal(area.querySelector('.msg--failed'), null);
    assert.match(area.textContent ?? '', /now do X/);
    assert.match(area.textContent ?? '', /Hi there/);
  });
});
