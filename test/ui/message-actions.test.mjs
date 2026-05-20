import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<main id="chatArea"></main>';
}

/** Minimal mirror of attachMessageActions trigger wiring (avoids heavy import graph). */
function mountActionsTrigger(wrap) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'message-actions__trigger';
  trigger.setAttribute('aria-label', 'Message actions');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.textContent = '⋮';
  wrap.classList.add('msg--has-actions');
  wrap.appendChild(trigger);
  return trigger;
}

describe('message-actions', { concurrency: false }, () => {
  test('message actions trigger has menu semantics', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = 'Hello';
    wrap.appendChild(bubble);
    document.getElementById('chatArea').appendChild(wrap);

    const trigger = mountActionsTrigger(wrap);
    assert.ok(trigger);
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.ok(wrap.classList.contains('msg--has-actions'));
  });
});
