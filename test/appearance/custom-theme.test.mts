/**
 * Custom theme token persistence and application.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  applyCustomTheme,
  clearCustomTheme,
  exportCustomThemeJson,
  getCustomThemeTokens,
  importCustomThemeJson,
  isCustomThemeAdvanced,
  isCustomThemeEnabled,
  replaceCustomThemeTokens,
  resetCustomThemeForTests,
  setCustomThemeAdvanced,
  setCustomThemeEnabled,
  setCustomThemeTokens,
} from '../../src/appearance/custom-theme.ts';
import { APPEARANCE_STORAGE_KEYS } from '../../src/appearance/types.ts';

const storage = new Map<string, string>();

function mockLocalStorage(): void {
  (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
}

function mockDocument(): void {
  const style = new Map<string, string>();
  (globalThis as typeof globalThis & { document?: Document }).document = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => style.set(name, value),
        removeProperty: (name: string) => {
          style.delete(name);
        },
        getPropertyValue: (name: string) => style.get(name) ?? '',
      },
    },
    querySelector: () => null,
  } as unknown as Document;
}

afterEach(() => {
  storage.clear();
  resetCustomThemeForTests();
});

describe('custom-theme', () => {
  test('setCustomThemeTokens persists and applies when enabled', () => {
    mockLocalStorage();
    mockDocument();
    setCustomThemeEnabled(true);
    setCustomThemeTokens({ bg: '#112233', fg: '#aabbcc' });
    assert.equal(isCustomThemeEnabled(), true);
    assert.equal(getCustomThemeTokens().bg, '#112233');
    assert.equal(
      document.documentElement.style.getPropertyValue('--mn-bg'),
      '#112233',
    );
  });

  test('clearCustomTheme removes inline overrides', () => {
    mockLocalStorage();
    mockDocument();
    setCustomThemeEnabled(true);
    setCustomThemeTokens({ bg: '#000000' });
    clearCustomTheme();
    assert.equal(
      document.documentElement.style.getPropertyValue('--mn-bg'),
      '',
    );
  });

  test('import and export round-trip', () => {
    mockLocalStorage();
    mockDocument();
    replaceCustomThemeTokens({ accent: '#ff00aa', bg: '#101010' });
    setCustomThemeEnabled(true);
    const json = exportCustomThemeJson();
    storage.clear();
    resetCustomThemeForTests();
    mockLocalStorage();
    mockDocument();
    assert.equal(importCustomThemeJson(json), true);
    assert.equal(getCustomThemeTokens().accent, '#ff00aa');
    assert.equal(isCustomThemeEnabled(), true);
  });

  test('disabled custom theme does not write tokens key on enable toggle off', () => {
    mockLocalStorage();
    setCustomThemeEnabled(false);
    assert.equal(storage.has(APPEARANCE_STORAGE_KEYS.customEnabled), false);
  });

  test('setCustomThemeAdvanced persists advanced editor flag', () => {
    mockLocalStorage();
    assert.equal(isCustomThemeAdvanced(), false);
    setCustomThemeAdvanced(true);
    assert.equal(isCustomThemeAdvanced(), true);
    assert.equal(storage.get(APPEARANCE_STORAGE_KEYS.customAdvanced), '1');
  });

  test('applyCustomTheme repairs legacy success=accent in simplified mode', () => {
    mockLocalStorage();
    mockDocument();
    // Legacy simplified derive cloned success from a non-green accent.
    storage.set(
      APPEARANCE_STORAGE_KEYS.customTokens,
      JSON.stringify({
        bg: '#101010',
        fg: '#eeeeee',
        accent: '#d4a574',
        danger: '#cc4444',
        success: '#d4a574',
        'success-soft': 'rgba(212,165,116,0.14)',
        'success-border': 'rgba(212,165,116,0.28)',
        'success-ink': '#e8c89a',
      }),
    );
    setCustomThemeEnabled(true);
    applyCustomTheme();
    const stored = getCustomThemeTokens();
    assert.notEqual(stored.success, stored.accent);
    assert.notEqual(
      document.documentElement.style.getPropertyValue('--mn-success'),
      document.documentElement.style.getPropertyValue('--mn-accent'),
    );
  });

  test('applyCustomTheme does not rewrite success=accent in advanced mode', () => {
    mockLocalStorage();
    mockDocument();
    setCustomThemeAdvanced(true);
    storage.set(
      APPEARANCE_STORAGE_KEYS.customTokens,
      JSON.stringify({
        accent: '#d4a574',
        success: '#d4a574',
      }),
    );
    setCustomThemeEnabled(true);
    applyCustomTheme();
    assert.equal(getCustomThemeTokens().success, '#d4a574');
  });
});
