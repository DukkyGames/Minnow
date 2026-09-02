import type { DesktopPrefs } from './types';

const STORAGE_PREFIX = 'minnow.os.';

export const DESKTOP_PREFS_KEYS = {
  desktopLayout: `${STORAGE_PREFIX}desktopLayout`,
} as const;

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = {
  desktopLayout: 'dock',
};

type DesktopPrefsListener = (prefs: DesktopPrefs) => void;

const listeners = new Set<DesktopPrefsListener>();
let cachedPrefs: DesktopPrefs | null = null;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function normalizeLayout(value: string | null): DesktopPrefs['desktopLayout'] {
  if (value === 'grid' || value === 'concierge' || value === 'dock') return 'dock';
  return DEFAULT_DESKTOP_PREFS.desktopLayout;
}

/** Load desktop prefs from localStorage (cached after first read). */
export function loadDesktopPrefs(): DesktopPrefs {
  if (cachedPrefs) return { ...cachedPrefs };

  const rawLayout = readStorage(DESKTOP_PREFS_KEYS.desktopLayout);
  const desktopLayout = normalizeLayout(rawLayout);
  if (rawLayout && rawLayout !== desktopLayout) {
    writeStorage(DESKTOP_PREFS_KEYS.desktopLayout, desktopLayout);
  }

  const prefs: DesktopPrefs = { desktopLayout };
  cachedPrefs = prefs;
  return { ...prefs };
}

function emitDesktopPrefs(): void {
  const prefs = loadDesktopPrefs();
  for (const fn of listeners) {
    try {
      fn({ ...prefs });
    } catch {}
  }
}

/** Persist all desktop prefs and notify subscribers. */
export function saveDesktopPrefs(prefs: DesktopPrefs): void {
  writeStorage(DESKTOP_PREFS_KEYS.desktopLayout, prefs.desktopLayout);
  cachedPrefs = { ...prefs };
  emitDesktopPrefs();
}

/** Persist one pref key and notify subscribers. */
export function saveDesktopPref<K extends keyof DesktopPrefs>(
  key: K,
  value: DesktopPrefs[K],
): void {
  const next = { ...loadDesktopPrefs(), [key]: value };
  saveDesktopPrefs(next);
}

/** Subscribe to desktop pref changes; returns unsubscribe. */
export function subscribeDesktopPrefs(listener: DesktopPrefsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Clear cached prefs and listeners (tests). */
export function resetDesktopPrefsForTests(): void {
  cachedPrefs = null;
  listeners.clear();
}
