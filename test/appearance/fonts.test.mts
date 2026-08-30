/**
 * Font preset stacks and persistence.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

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

const STYLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles');

/** Recursively list CSS files under src/styles. */
function walkCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkCssFiles(full));
    else if (ent.name.endsWith('.css')) out.push(full);
  }
  return out;
}

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

  // --mn-font-mono was never defined. Appearance writes --font-mono on
  // documentElement; leftover --mn-font-mono rules ignored that preference.
  test('stylesheets do not reference the undefined --mn-font-mono alias', () => {
    const hits: string[] = [];
    for (const file of walkCssFiles(STYLES_DIR)) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('--mn-font-mono')) {
        hits.push(path.relative(STYLES_DIR, file));
      }
    }
    assert.deepEqual(hits, []);
  });

  test('mono surfaces follow documentElement --font-mono after a preset change', () => {
    const win = new Window();
    const style = win.document.createElement('style');
    style.textContent = [
      readFileSync(path.join(STYLES_DIR, 'tokens.css'), 'utf8'),
      readFileSync(path.join(STYLES_DIR, 'command-palette.css'), 'utf8'),
      readFileSync(path.join(STYLES_DIR, 'context-menu.css'), 'utf8'),
      readFileSync(path.join(STYLES_DIR, 'context-usage.css'), 'utf8'),
      readFileSync(path.join(STYLES_DIR, 'code-change-strip.css'), 'utf8'),
      readFileSync(path.join(STYLES_DIR, 'shell-keyboard-help.css'), 'utf8'),
      readFileSync(path.join(STYLES_DIR, 'settings-page.css'), 'utf8'),
      readFileSync(path.join(STYLES_DIR, 'onboarding.css'), 'utf8'),
    ].join('\n');
    win.document.head.appendChild(style);

    // Same write applyAppearanceFonts performs for Settings → Appearance → Fonts.
    const stack = MONO_FONT_STACKS['ibm-plex-mono'];
    win.document.documentElement.style.setProperty('--font-mono', stack);

    const classes = [
      'mn-palette__shortcut',
      'mn-menu__shortcut',
      'context-usage-breakdown__model',
      'code-change-strip__stats',
      'shell-keyboard-help__kbd',
      'settings-proposal-body',
      'mn-onboarding__progress-label',
    ];
    for (const className of classes) {
      const el = win.document.createElement('span');
      el.className = className;
      el.textContent = '0123456789';
      win.document.body.appendChild(el);
      const family = win.getComputedStyle(el).fontFamily;
      assert.match(
        family,
        /IBM Plex Mono/,
        `${className} computed font-family ${JSON.stringify(family)} should follow --font-mono`,
      );
    }
    win.close();
  });
});
