/**
 * Theme preference resolution (no DOM side effects beyond matchMedia when testing system).
 */

import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { THEME_STORAGE_KEY } from '../../src/constants.ts';

describe('theme-resolve', () => {
  const prev = globalThis.localStorage;
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: prev,
    });
  });

  test('resolveTheme returns light or dark for explicit prefs without matchMedia', async () => {
    const { resolveTheme } = await import('../../src/ui/theme-resolve.ts');
    assert.equal(resolveTheme('light'), 'light');
    assert.equal(resolveTheme('dark'), 'dark');
  });

  test('getThemePreference defaults to light when storage empty', async () => {
    const { getThemePreference } = await import('../../src/ui/theme-resolve.ts');
    assert.equal(getThemePreference(), 'light');
  });

  test('getThemePreference reads valid stored value', async () => {
    store.set(THEME_STORAGE_KEY, 'system');
    const { getThemePreference } = await import('../../src/ui/theme-resolve.ts');
    assert.equal(getThemePreference(), 'system');
  });

  test('resolveTheme system follows matchMedia', async () => {
    const { resolveTheme } = await import('../../src/ui/theme-resolve.ts');
    const mm = { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
    const orig = globalThis.matchMedia;
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: () => mm,
    });
    try {
      assert.equal(resolveTheme('system'), 'dark');
      mm.matches = false;
      assert.equal(resolveTheme('system'), 'light');
    } finally {
      Object.defineProperty(globalThis, 'matchMedia', {
        configurable: true,
        value: orig,
      });
    }
  });
});
