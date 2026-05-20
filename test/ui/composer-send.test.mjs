import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setComposerStreamingMode } = await import('../../src/ui/composer-send.ts');

function setupSendButton() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  const btn = document.createElement('button');
  btn.id = 'sendBtn';
  btn.type = 'button';
  btn.innerHTML = `
    <span id="sendIcon"></span>
    <span id="sendStopIcon" class="hidden"></span>
    <span id="sendSpinner" class="hidden"></span>
  `;
  document.body.appendChild(btn);

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);

  return btn;
}

describe('setComposerStreamingMode', () => {
  test('streaming mode shows stop affordance and keeps button enabled', () => {
    const btn = setupSendButton();
    setComposerStreamingMode('streaming');

    assert.equal(btn.disabled, false);
    assert.equal(btn.dataset.mode, 'stop');
    assert.equal(btn.getAttribute('aria-label'), 'Stop generating');
    assert.ok(btn.classList.contains('send-btn--stop'));
    assert.ok(!document.getElementById('sendStopIcon').classList.contains('hidden'));
    assert.ok(document.getElementById('sendIcon').classList.contains('hidden'));
    assert.equal((document.getElementById('msgInput')).disabled, false);
  });

  test('idle mode restores send affordance', () => {
    const btn = setupSendButton();
    setComposerStreamingMode('streaming');
    setComposerStreamingMode('idle');

    assert.equal(btn.disabled, false);
    assert.equal(btn.dataset.mode, 'send');
    assert.equal(btn.getAttribute('aria-label'), 'Send message');
    assert.ok(!btn.classList.contains('send-btn--stop'));
    assert.ok(!document.getElementById('sendIcon').classList.contains('hidden'));
    assert.ok(document.getElementById('sendStopIcon').classList.contains('hidden'));
  });
});
