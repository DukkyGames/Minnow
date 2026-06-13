/**
 * CSS color parse/format helpers for appearance token editors.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatCssColor,
  parseCssColor,
  rgbaToColorInputValue,
} from '../../src/appearance/color-format.ts';

describe('color-format', () => {
  test('parse hex 6-digit', () => {
    assert.deepEqual(parseCssColor('#0f1216'), { r: 15, g: 18, b: 22, a: 1 });
  });

  test('parse hex 3-digit', () => {
    assert.deepEqual(parseCssColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  });

  test('parse rgba', () => {
    assert.deepEqual(parseCssColor('rgba(255, 255, 255, 0.06)'), {
      r: 255,
      g: 255,
      b: 255,
      a: 0.06,
    });
  });

  test('format opaque as hex', () => {
    assert.equal(formatCssColor({ r: 15, g: 18, b: 22, a: 1 }), '#0f1216');
  });

  test('format translucent as rgba', () => {
    assert.equal(
      formatCssColor({ r: 255, g: 255, b: 255, a: 0.06 }),
      'rgba(255, 255, 255, 0.06)',
    );
  });

  test('color input value strips alpha', () => {
    assert.equal(
      rgbaToColorInputValue({ r: 255, g: 0, b: 128, a: 0.5 }),
      '#ff0080',
    );
  });
});
