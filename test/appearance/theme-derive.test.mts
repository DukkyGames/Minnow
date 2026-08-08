/**
 * Theme palette derivation from simplified seed colors.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCssColor } from '../../src/appearance/color-format.ts';
import {
  deriveThemeTokensFromSeeds,
  extractSimplifiedSeeds,
  relativeLuminance,
  repairLegacyMirroredSuccess,
} from '../../src/appearance/theme-derive.ts';
import { CORE_THEME_TOKEN_KEYS } from '../../src/appearance/types.ts';

describe('theme-derive', () => {
  test('deriveThemeTokensFromSeeds returns every core token', () => {
    const tokens = deriveThemeTokensFromSeeds({
      bg: '#0f1216',
      fg: '#dfe3e8',
      accent: '#9ec5a7',
      danger: '#e07a6f',
    });
    for (const key of CORE_THEME_TOKEN_KEYS) {
      assert.ok(tokens[key], `missing ${key}`);
      assert.ok(parseCssColor(tokens[key]), `invalid color for ${key}: ${tokens[key]}`);
    }
  });

  test('dark seeds produce darker shadow than light seeds', () => {
    const dark = deriveThemeTokensFromSeeds({
      bg: '#0f1216',
      fg: '#dfe3e8',
      accent: '#9ec5a7',
      danger: '#e07a6f',
    });
    const light = deriveThemeTokensFromSeeds({
      bg: '#f7f7f4',
      fg: '#1c2127',
      accent: '#5b8a72',
      danger: '#c45c4f',
    });
    const darkShadow = parseCssColor(dark.shadow)!;
    const lightShadow = parseCssColor(light.shadow)!;
    assert.ok(darkShadow.a > lightShadow.a);
  });

  test('success stays a distinct green, not a copy of accent', () => {
    // Non-green accent (ocean-like cyan) must not paint status/ok chrome as cyan.
    const tokens = deriveThemeTokensFromSeeds({
      bg: '#101010',
      fg: '#eeeeee',
      accent: '#7dd3e8',
      danger: '#cc4444',
    });
    assert.notEqual(tokens.success, tokens.accent);
    assert.notEqual(tokens['success-soft'], tokens['accent-soft']);

    const success = parseCssColor(tokens.success)!;
    const accent = parseCssColor(tokens.accent)!;
    // Green channel should dominate blue for a semantic success green.
    assert.ok(success.g > success.b, `expected green-dominant success, got ${tokens.success}`);
    assert.ok(accent.b > accent.g, `fixture accent should be cyan-dominant, got ${tokens.accent}`);
  });

  test('success remains green when accent is already green', () => {
    const tokens = deriveThemeTokensFromSeeds({
      bg: '#0f1216',
      fg: '#dfe3e8',
      accent: '#9ec5a7',
      danger: '#e07a6f',
    });
    const success = parseCssColor(tokens.success)!;
    assert.ok(success.g >= success.r && success.g >= success.b);
  });

  test('repairLegacyMirroredSuccess rewrites cloned success tokens', () => {
    const broken = {
      bg: '#101010',
      fg: '#eeeeee',
      accent: '#d4a574',
      danger: '#cc4444',
      success: '#d4a574',
      'success-soft': 'rgba(212,165,116,0.14)',
      'success-ink': '#e8c89a',
    };
    const repaired = repairLegacyMirroredSuccess(broken);
    assert.notEqual(repaired.success, repaired.accent);
    const success = parseCssColor(repaired.success!)!;
    assert.ok(success.g > success.b);

    const alreadyOk = { ...broken, success: '#a8c48a' };
    assert.equal(repairLegacyMirroredSuccess(alreadyOk), alreadyOk);
  });

  test('extractSimplifiedSeeds prefers explicit token values', () => {
    const seeds = extractSimplifiedSeeds({
      bg: '#111111',
      fg: '#eeeeee',
      accent: '#aabbcc',
      danger: '#ff0000',
      'surface-1': '#222222',
    });
    assert.deepEqual(seeds, {
      bg: '#111111',
      fg: '#eeeeee',
      accent: '#aabbcc',
      danger: '#ff0000',
    });
  });

  test('relativeLuminance ranks white above black', () => {
    assert.ok(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 }) > relativeLuminance({ r: 0, g: 0, b: 0, a: 1 }));
  });
});
