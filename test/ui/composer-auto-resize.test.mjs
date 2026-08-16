import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const {
  autoResize,
  bindComposerAutoResize,
  setComposerFieldSizingSupportedForTests,
} = await import('../../src/ui/input.ts');

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
  afterEach(() => {
    setComposerFieldSizingSupportedForTests(null);
  });

  test('short content stays hidden overflow under 40vh cap', () => {
    setComposerFieldSizingSupportedForTests(false);
    const el = setupTextarea();
    el.value = 'Hello';
    autoResize(el);

    assert.equal(el.style.overflowY, 'hidden');
    assert.ok(parseInt(el.style.height, 10) >= 44);
    assert.ok(parseInt(el.style.height, 10) <= 320);
  });

  test('cleared value resets to minimum height', () => {
    setComposerFieldSizingSupportedForTests(false);
    const el = setupTextarea();
    el.value = 'Line one\nLine two\nLine three';
    autoResize(el);
    el.value = '';
    autoResize(el);

    assert.equal(el.style.overflowY, 'hidden');
    assert.equal(el.style.height, '44px');
  });

  test('single-line typing does not collapse height to auto', () => {
    setComposerFieldSizingSupportedForTests(false);
    const el = setupTextarea();
    el.value = 'Hello';
    autoResize(el);
    const firstHeight = el.style.height;
    el.value = 'Hello world';
    autoResize(el);

    assert.equal(el.style.height, firstHeight);
    assert.notEqual(el.style.height, 'auto');
  });

  test('field-sizing path clears leftover inline height', () => {
    setComposerFieldSizingSupportedForTests(true);
    const el = setupTextarea();
    el.style.height = '120px';
    el.value = 'Hello';
    autoResize(el);

    assert.equal(el.style.height, '');
  });

  test('JS fallback honors a taller CSS min-height (Super Plan floor)', () => {
    setComposerFieldSizingSupportedForTests(false);
    const el = setupTextarea();
    el.style.minHeight = '96px';
    el.value = '';
    autoResize(el);

    assert.equal(el.style.height, '96px');
    assert.equal(el.style.overflowY, 'hidden');
  });

  test('bindComposerAutoResize is idempotent and skips JS when field-sizing works', () => {
    setComposerFieldSizingSupportedForTests(true);
    const el = setupTextarea();
    bindComposerAutoResize(el);
    bindComposerAutoResize(el);

    assert.equal(el.dataset.composerAutoResizeWired, '1');
    assert.equal(el.style.height, '');
  });
});
