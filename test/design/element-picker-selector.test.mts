import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  buildCssSelectorForElement,
  isStablePickerClass,
  uidFallbackSelector,
} from '../../src/design/element-picker.ts';

function setupDoc(html: string): { document: Document; window: Window } {
  const win = new Window();
  win.document.body.innerHTML = html;
  return { document: win.document, window: win };
}

describe('design element picker selector', () => {
  afterEach(() => {
    /* happy-dom windows are ephemeral per test */
  });

  test('isStablePickerClass rejects css-/sc-/hash noise', () => {
    assert.equal(isStablePickerClass('btn'), true);
    assert.equal(isStablePickerClass('css-abc123'), false);
    assert.equal(isStablePickerClass('sc-Component'), false);
    assert.equal(isStablePickerClass('_private'), false);
    assert.equal(isStablePickerClass('item-a1b2c3d4e5'), false);
  });

  test('unique id selector round-trips', () => {
    const { document } = setupDoc('<button id="saveBtn">Save</button>');
    const el = document.getElementById('saveBtn')!;
    const { cssSelector } = buildCssSelectorForElement(document, el, { nextUid: 1 });
    assert.equal(cssSelector, '#saveBtn');
    assert.equal(document.querySelector(cssSelector), el);
  });

  test('stable class chain with nth-of-type when ambiguous', () => {
    const { document } = setupDoc(`
      <div>
        <p class="lead">A</p>
        <p class="lead">B</p>
      </div>
    `);
    const second = document.querySelectorAll('p.lead')[1] as Element;
    const { cssSelector } = buildCssSelectorForElement(document, second, { nextUid: 2 });
    assert.match(cssSelector, /p\.lead/);
    assert.match(cssSelector, /nth-of-type\(2\)/);
    assert.equal(document.querySelector(cssSelector), second);
  });

  test('hash-like classes are skipped in the chain', () => {
    const { document } = setupDoc(
      '<div class="css-xyz123 stable"><span class="css-deadbeef">X</span></div>',
    );
    const span = document.querySelector('span')!;
    const { cssSelector } = buildCssSelectorForElement(document, span, { nextUid: 3 });
    assert.doesNotMatch(cssSelector, /css-deadbeef/);
    assert.equal(document.querySelector(cssSelector), span);
  });

  test('depth cap stays at six ancestors', () => {
    const tags = Array.from({ length: 10 }, () => '<div class="layer">').join('');
    const closes = '</div>'.repeat(10);
    const { document } = setupDoc(`${tags}<button class="target">Go</button>${closes}`);
    const btn = document.querySelector('button.target')!;
    const { cssSelector } = buildCssSelectorForElement(document, btn, { nextUid: 4 });
    const depth = cssSelector.split('>').length;
    assert.ok(depth <= 6, `selector depth ${depth} exceeds cap`);
    assert.equal(document.querySelector(cssSelector), btn);
  });

  test('always stamps data-mn-uid fallback for browser_click', () => {
    const { document } = setupDoc('<button>Click</button>');
    const btn = document.querySelector('button')!;
    const { uid } = buildCssSelectorForElement(document, btn, { nextUid: 7 });
    assert.equal(uid, 7);
    assert.equal(btn.getAttribute('data-mn-uid'), '7');
    assert.equal(document.querySelector(uidFallbackSelector(7)), btn);
  });
});
