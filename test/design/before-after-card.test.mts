/**
 * Before/after diff card (MIN-370 P1): toggle button flips the rendered image between the
 * before/after captures; disabled + labeled clearly when one side is missing.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { renderBeforeAfterCard } from '../../src/design/before-after-card.ts';
import type { BeforeAfterPair } from '../../src/design/before-after.ts';

function pair(overrides: Partial<BeforeAfterPair> = {}): BeforeAfterPair {
  return {
    id: 'bapair-1',
    chatId: 'chat-1',
    turnId: '3',
    paths: ['index.html'],
    before: { dataUrl: 'data:image/png;base64,BEFORE', capturedAt: 1 },
    after: { dataUrl: 'data:image/png;base64,AFTER', capturedAt: 2 },
    createdAt: 3,
    ...overrides,
  };
}

describe('renderBeforeAfterCard', () => {
  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('starts on "after" and toggling flips to "before" and back', () => {
    const card = renderBeforeAfterCard(pair());
    const img = card.querySelector('img')!;
    const toggle = card.querySelector('button')!;

    assert.equal(img.src, 'data:image/png;base64,AFTER');
    assert.equal(toggle.disabled, false);

    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(img.src, 'data:image/png;base64,BEFORE');

    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(img.src, 'data:image/png;base64,AFTER');
  });

  test('single file shows the path as the label; multiple files show a count', () => {
    const single = renderBeforeAfterCard(pair({ paths: ['index.html'] }));
    assert.equal(single.querySelector('.mn-before-after-card__header')!.textContent, 'index.html');

    const multi = renderBeforeAfterCard(pair({ paths: ['a.css', 'b.css'] }));
    assert.equal(multi.querySelector('.mn-before-after-card__header')!.textContent, '2 files changed');
  });

  test('missing before capture disables the toggle and shows the after image', () => {
    const card = renderBeforeAfterCard(pair({ before: null }));
    const img = card.querySelector('img')!;
    const toggle = card.querySelector('button')!;
    assert.equal(img.src, 'data:image/png;base64,AFTER');
    assert.equal(toggle.disabled, true);
  });

  test('missing after capture falls back to showing before', () => {
    const card = renderBeforeAfterCard(pair({ after: null }));
    const img = card.querySelector('img')!;
    assert.equal(img.src, 'data:image/png;base64,BEFORE');
    assert.equal(card.querySelector('button')!.disabled, true);
  });

  test('root carries the pair id for later lookup/removal', () => {
    const card = renderBeforeAfterCard(pair({ id: 'bapair-xyz' }));
    assert.equal(card.dataset.pairId, 'bapair-xyz');
  });
});
