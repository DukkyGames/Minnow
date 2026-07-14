/**
 * A11y quick-pass (MIN-370): accessible-name + WCAG contrast-ratio helpers, pure and DOM-free
 * except for computeAccessibleNameForElement (happy-dom).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  computeAccessibleNameForElement,
  computeContrastRatioFromStylesDigest,
  contrastRatioOf,
  parseCssColor,
  relativeLuminance,
} from '../../src/design/element-picker.ts';

describe('parseCssColor', () => {
  test('parses rgb()', () => {
    assert.deepEqual(parseCssColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  });

  test('parses rgba() with alpha', () => {
    assert.deepEqual(parseCssColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  });

  test('parses 6-digit hex', () => {
    assert.deepEqual(parseCssColor('#ff0000'), { r: 255, g: 0, b: 0, a: 1 });
  });

  test('parses 3-digit hex', () => {
    assert.deepEqual(parseCssColor('#f00'), { r: 255, g: 0, b: 0, a: 1 });
  });

  test('returns null for transparent', () => {
    assert.equal(parseCssColor('transparent'), null);
  });

  test('returns null for unparseable input', () => {
    assert.equal(parseCssColor('currentcolor'), null);
  });
});

describe('relativeLuminance / contrastRatioOf', () => {
  test('black vs white is the maximum ~21:1 ratio', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    assert.equal(relativeLuminance(black), 0);
    assert.ok(relativeLuminance(white) > 0.99);
    const ratio = contrastRatioOf(black, white);
    assert.ok(ratio > 20.9 && ratio < 21.1, `expected ~21, got ${ratio}`);
  });

  test('identical colors have a 1:1 ratio', () => {
    const gray = { r: 128, g: 128, b: 128 };
    assert.equal(contrastRatioOf(gray, gray), 1);
  });

  test('ratio is symmetric regardless of argument order', () => {
    const a = { r: 10, g: 20, b: 30 };
    const b = { r: 200, g: 210, b: 220 };
    assert.equal(contrastRatioOf(a, b), contrastRatioOf(b, a));
  });
});

describe('computeContrastRatioFromStylesDigest', () => {
  test('computes ratio from a well-formed digest', () => {
    const digest = 'font:16px/1.5 Arial 400; color:rgb(0, 0, 0); bg:rgb(255, 255, 255); p:0px m:0px; layout:block';
    const ratio = computeContrastRatioFromStylesDigest(digest);
    assert.ok(ratio && ratio > 20.9 && ratio < 21.1, `expected ~21, got ${ratio}`);
  });

  test('returns null when the background is fully transparent', () => {
    const digest = 'font:16px/1.5 Arial 400; color:rgb(0, 0, 0); bg:rgba(0, 0, 0, 0); p:0px m:0px; layout:block';
    assert.equal(computeContrastRatioFromStylesDigest(digest), null);
  });

  test('returns null when the digest has no color/bg segments', () => {
    assert.equal(computeContrastRatioFromStylesDigest('layout:block'), null);
  });
});

describe('computeAccessibleNameForElement', () => {
  let win: Window;

  afterEach(() => {
    void win;
  });

  function el(html: string): Element {
    win = new Window();
    win.document.body.innerHTML = html;
    return win.document.body.firstElementChild!;
  }

  test('prefers aria-label', () => {
    const target = el('<button aria-label="Close dialog">X</button>');
    assert.equal(computeAccessibleNameForElement(target), 'Close dialog');
  });

  test('falls back to alt', () => {
    const target = el('<img alt="Company logo" src="x.png" />');
    assert.equal(computeAccessibleNameForElement(target), 'Company logo');
  });

  test('falls back to trimmed, collapsed text content', () => {
    const target = el('<button>  Buy\n  now  </button>');
    assert.equal(computeAccessibleNameForElement(target), 'Buy now');
  });

  test('caps at 160 characters', () => {
    const long = 'x'.repeat(300);
    const target = el(`<button>${long}</button>`);
    assert.equal(computeAccessibleNameForElement(target).length, 160);
  });
});
