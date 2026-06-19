/**
 * Font preset stacks and persistence.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  applyAppearanceFonts,
  getAppearanceFonts,
  MONO_FONT_STACKS,
  resetAppearanceFontsForTests,
  setAppearanceFonts,
  subscribeAppearanceFonts,
  UI_FONT_STACKS,
} from '../../src/appearance/fonts.ts';
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
  (globalThis as typeof globalThis & { document?: unknown }).document = {
    documentElement: { style: { setProperty: () => {} } },
  };
}

afterEach(() => {
  storage.clear();
  resetAppearanceFontsForTests();
});

describe('appearance fonts', () => {
  test('default fonts are system presets', () => {
    mockLocalStorage();
    const fonts = getAppearanceFonts();
    assert.equal(fonts.ui.kind, 'preset');
    assert.equal(fonts.mono.kind, 'preset');
    if (fonts.ui.kind === 'preset') assert.equal(fonts.ui.id, 'system');
  });

  test('setAppearanceFonts persists JSON', () => {
    mockLocalStorage();
    setAppearanceFonts({
      ui: { kind: 'preset', slot: 'ui', id: 'inter' },
      mono: { kind: 'preset', slot: 'mono', id: 'jetbrains-mono' },
    });
    const raw = storage.get(APPEARANCE_STORAGE_KEYS.fonts);
    assert.ok(raw?.includes('inter'));
    const loaded = getAppearanceFonts();
    if (loaded.ui.kind === 'preset') assert.equal(loaded.ui.id, 'inter');
  });

  test('preset stacks include fallbacks', () => {
    assert.match(UI_FONT_STACKS.inter, /Inter/);
    assert.match(MONO_FONT_STACKS['jetbrains-mono'], /JetBrains Mono/);
  });

  // Regression: applying fonts must not notify font listeners. theme.ts
  // subscribes a listener that re-applies fonts; if applyAppearanceFonts emits,
  // that recurses infinitely (RangeError: Maximum call stack size exceeded) and
  // aborts boot. See MIN-262 crash log.
  test('applyAppearanceFonts does not re-emit to font listeners', async () => {
    mockLocalStorage();
    mockDocument();
    let reapplies = 0;
    const unsub = subscribeAppearanceFonts(() => {
      reapplies += 1;
      void applyAppearanceFonts();
    });
    await applyAppearanceFonts();
    unsub();
    assert.equal(reapplies, 0);
  });
});
