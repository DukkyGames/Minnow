/**
 * Theme preference resolution (no DOM, no hljs). Used by theme.ts and unit tests.
 */

import { THEME_STORAGE_KEY, type ThemePreference } from '../constants';

function isThemePreference(v: string | null): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

/** Read persisted preference; missing or invalid defaults to light (legacy behavior). */
export function getThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    /* private mode */
  }
  return 'light';
}

/** Resolve stored or passed preference to the active color mode. */
export function resolveTheme(pref?: ThemePreference): 'light' | 'dark' {
  const p = pref ?? getThemePreference();
  if (p === 'dark') return 'dark';
  if (p === 'light') return 'light';
  if (typeof globalThis.matchMedia === 'function') {
    return globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}
