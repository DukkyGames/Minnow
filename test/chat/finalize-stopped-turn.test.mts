import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { markMessageStopped } from '../../src/ui/stopped-affordance.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
}

describe('stopped assistant affordance', () => {
  test('markMessageStopped adds chip to assistant row', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const label = document.createElement('div');
    label.className = 'msg-label';
    wrap.appendChild(label);

    markMessageStopped(wrap);

    assert.ok(wrap.classList.contains('msg--stopped'));
    assert.equal(wrap.querySelector('.msg-stopped-chip')?.textContent, 'Generation stopped');
  });
});
