/**
 * Reef theme token forwarding from host document.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  buildThemeCssBlock,
  readThemeVarsFromElement,
  REEF_THEME_TOKEN_NAMES,
  subscribeThemeChanges,
} from '../../../src/chat/reef/theme-forward.ts';

let themeUnsub: (() => void) | null = null;

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  const root = document.documentElement;
  root.setAttribute('data-theme', 'sage-dark');
  for (const name of REEF_THEME_TOKEN_NAMES) {
    root.style.setProperty(name, `test-${name}`);
  }
}

describe('theme-forward', () => {
  afterEach(() => {
    themeUnsub?.();
    themeUnsub = null;
  });

  test('readThemeVarsFromElement returns non-empty token map', () => {
    setupDom();
    const vars = readThemeVarsFromElement(document.documentElement);
    assert.equal(vars['--mn-bg'], 'test---mn-bg');
    assert.ok(vars['--mn-fg']);
  });

  test('buildThemeCssBlock emits :root rules', () => {
    const css = buildThemeCssBlock({ '--mn-fg': '#1c2127' });
    assert.match(css, /:root/);
    assert.match(css, /--mn-fg:\s*#1c2127/);
  });

  test('subscribeThemeChanges fires when data-theme changes', () => {
    setupDom();
    let calls = 0;
    themeUnsub = subscribeThemeChanges(() => {
      calls += 1;
    });
    assert.equal(calls, 1);
    document.documentElement.setAttribute('data-theme', 'sage-light');
    assert.equal(document.documentElement.getAttribute('data-theme'), 'sage-light');
    themeUnsub();
    themeUnsub = null;
  });
});
