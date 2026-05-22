import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { autoResize } = await import('../../src/ui/input.ts');

function setupTextarea() {
  const window = new Window({ innerHeight: 800 });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  const el = document.createElement('textarea');
  el.id = 'msgInput';
  el.style.boxSizing = 'border-box';
  el.style.padding = '11px 14px';
  el.style.lineHeight = '1.55';
  el.style.fontSize = '14px';
  el.style.width = '400px';
  document.body.appendChild(el);
  return el;
}

describe('autoResize', () => {
  test('short content stays hidden overflow under 40vh cap', () => {
    const el = setupTextarea();
    el.value = 'Hello';
    autoResize(el);

    assert.equal(el.style.overflowY, 'hidden');
    assert.ok(parseInt(el.style.height, 10) >= 44);
    assert.ok(parseInt(el.style.height, 10) <= 320);
  });

  test('cleared value resets to minimum height', () => {
    const el = setupTextarea();
    el.value = 'Line one\nLine two\nLine three';
    autoResize(el);
    el.value = '';
    autoResize(el);

    assert.equal(el.style.overflowY, 'hidden');
    assert.equal(el.style.height, '44px');
  });
});
