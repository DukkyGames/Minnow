/**
 * Appearance: Light / Dark / System. Resolves to effective light|dark on <html data-theme>.
 * Syncs theme-color meta, optional hljs dark stylesheet, CodeMirror token vars, and xterm.
 */

import hljs from 'highlight.js';
import hljsDarkStylesheetUrl from 'highlight.js/styles/github-dark.min.css?url';
import type { ThemePreference } from '../constants';
import { THEME_STORAGE_KEY } from '../constants';
import { getThemePreference, resolveTheme } from './theme-resolve';
import { refreshXtermTheme } from './terminal-xterm';

export { getThemePreference, resolveTheme } from './theme-resolve';

/** Light theme-color for browser chrome (matches light --bg). */
const THEME_COLOR_LIGHT = '#fefefe';
/** Dark theme-color (matches dark --bg). */
const THEME_COLOR_DARK = '#121218';

let systemListener: MediaQueryList | null = null;
let onSystemChange: (() => void) | null = null;

/** Persist preference and apply effective theme. */
export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  syncThemeListeners(pref);
  applyThemeFromPreference(pref);
}

function updateThemeColorMeta(effective: 'light' | 'dark'): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.setAttribute('content', effective === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
}

const HLJS_DARK_LINK_ID = 'minnow-hljs-github-dark';

function syncHljsDarkStylesheet(effective: 'light' | 'dark'): void {
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

/**
 * Re-run highlight.js on fenced blocks so class-based colors match the active stylesheet.
 */
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

/** Apply effective light|dark to the document root and dependent surfaces. */
export function applyResolvedTheme(effective: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
  updateThemeColorMeta(effective);
  syncHljsDarkStylesheet(effective);
  refreshHljsInDocument();
  refreshXtermTheme();
}

/** Apply from a preference value (resolves system). */
export function applyThemeFromPreference(pref: ThemePreference): void {
  applyResolvedTheme(resolveTheme(pref));
}

function detachSystemListener(): void {
  if (systemListener && onSystemChange) {
    systemListener.removeEventListener('change', onSystemChange);
  }
  systemListener = null;
  onSystemChange = null;
}

function attachSystemListener(): void {
  detachSystemListener();
  if (typeof globalThis.matchMedia === 'function') return;
  systemListener = globalThis.matchMedia('(prefers-color-scheme: dark)');
  onSystemChange = () => {
    if (getThemePreference() !== 'system') return;
    applyResolvedTheme(resolveTheme('system'));
  };
  systemListener.addEventListener('change', onSystemChange!);
}

/**
 * Call once at startup after DOM exists. Re-reads storage and wires system listener.
 * Inline script in index.html already set data-theme for first paint; this syncs the rest.
 */
export function initTheme(): void {
  const pref = getThemePreference();
  syncThemeListeners(pref);
  applyResolvedTheme(resolveTheme(pref));
}

/** When preference becomes system vs fixed, update media listener. */
export function syncThemeListeners(pref: ThemePreference): void {
  if (pref === 'system') attachSystemListener();
  else detachSystemListener();
}
