import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { showToast } = await import('../../src/ui/toast.ts');

function setupDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => {
    cb(0);
    return 0;
  };
}

describe('toast', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('showToast renders success toast with message', () => {
    setupDom();
    showToast('Committed changes', 'success');

    const toast = document.querySelector('.mn-toast.mn-toast--success');
    assert.ok(toast);
    assert.equal(toast.textContent, 'Committed changes');
    assert.equal(toast.getAttribute('role'), 'status');
    assert.ok(toast.classList.contains('mn-toast--visible'));
  });

  test('showToast renders error variant', () => {
    setupDom();
    showToast('Git operation failed', 'error');

    const toast = document.querySelector('.mn-toast.mn-toast--error');
    assert.ok(toast);
    assert.equal(toast.textContent, 'Git operation failed');
  });

  test('showToast ignores empty messages', () => {
    setupDom();
    showToast('   ', 'success');
    assert.equal(document.querySelector('.mn-toast'), null);
  });
});
