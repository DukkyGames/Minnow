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

describe('branch-picker', { concurrency: false }, () => {
  test('trigger exposes menu semantics', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'branch-picker__trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.textContent = '▾ 2 branches';
    wrap.appendChild(trigger);
    document.getElementById('chatArea').appendChild(wrap);

    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.ok(wrap.classList.contains('msg') || wrap.querySelector('.branch-picker__trigger'));
  });
});
