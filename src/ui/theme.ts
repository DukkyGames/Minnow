/**
 * Appearance: applies palette themes, hljs, CodeMirror, and xterm sync.
 */

import hljs from 'highlight.js';
import hljsDarkStylesheetUrl from 'highlight.js/styles/github-dark.min.css?url';
import {
  applyTheme as applyThemeId,
  getFollowSystem,
  getMode,
  getStoredTheme,
  getThemePreference,
  initTheme as initThemeCore,
  resolveTheme,
  setFollowSystem,
  setThemeFamily,
  setThemeMode,
  setThemePreference as persistThemePreference,
  syncThemeListeners,
  type LegacyThemePreference,
  type ThemeFamily,
  type ThemeId,
  type ThemeMode,
} from '../theme';
import { refreshXtermTheme } from './terminal-xterm';

export {
  getFollowSystem,
  getStoredTheme,
  getThemePreference,
  resolveTheme,
  setFollowSystem,
  setThemeFamily,
  setThemeMode,
  syncThemeListeners,
  type LegacyThemePreference as ThemePreference,
  type ThemeFamily,
  type ThemeId,
  type ThemeMode,
};

const HLJS_DARK_LINK_ID = 'minnow-hljs-github-dark';

function syncHljsDarkStylesheet(effective: ThemeMode): void {
  const existing = document.getElementById(HLJS_DARK_LINK_ID) as HTMLLinkElement | null;
  if (effective === 'dark') {
    if (existing) return;
    const link = document.createElement('link');
    link.id = HLJS_DARK_LINK_ID;
    link.rel = 'stylesheet';
    link.href = hljsDarkStylesheetUrl;
    document.head.appendChild(link);
  } else if (existing) {
    existing.remove();
  }
}

/** Re-run highlight.js on fenced blocks so class-based colors match the active stylesheet. */
export function refreshHljsInDocument(): void {
  document.querySelectorAll('pre code.hljs').forEach((block) => {
    const el = block as HTMLElement;
    const plain = el.textContent ?? '';
    el.removeAttribute('data-highlighted');
    el.classList.remove('hljs');
    el.textContent = plain;
    try {
      hljs.highlightElement(el);
    } catch {
      /* partial fence or unknown grammar */
    }
  });
}

/** Apply effective theme to DOM and dependent surfaces. */
export function applyResolvedTheme(id: ThemeId): void {
  applyThemeId(id, { persist: false });
  syncHljsDarkStylesheet(getMode(id));
  refreshHljsInDocument();
  refreshXtermTheme();
}

/** @deprecated Use applyResolvedTheme(getStoredTheme()). */
export function applyThemeFromPreference(_pref?: LegacyThemePreference): void {
  applyResolvedTheme(getStoredTheme());
}

/** Call once at startup after DOM exists. */
export function initTheme(): void {
  initThemeCore();
  syncThemeListeners();
  applyResolvedTheme(getStoredTheme());
}

/** Persist preference and refresh hljs/xterm. */
export function setThemePreference(pref: LegacyThemePreference): void {
  persistThemePreference(pref);
  syncThemeListeners();
  applyResolvedTheme(getStoredTheme());
}
