import type { DesktopPrefs } from './types';

const STORAGE_PREFIX = 'minnow.os.';

export const DESKTOP_PREFS_KEYS = {
  desktopLayout: `${STORAGE_PREFIX}desktopLayout`,
  wallpaper: `${STORAGE_PREFIX}wallpaper`,
  previewStyle: `${STORAGE_PREFIX}previewStyle`,
} as const;

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = {
  desktopLayout: 'concierge',
  wallpaper: 'underwater',
  previewStyle: 'card',
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
  } catch {
    /* private mode */
  }
}

function normalizeLayout(value: string | null): DesktopPrefs['desktopLayout'] {
  if (value === 'grid') return 'grid';
  // Legacy `dock` layout is no longer shown on the home screen.
  return DEFAULT_DESKTOP_PREFS.desktopLayout;
}

function normalizeWallpaper(value: string | null): DesktopPrefs['wallpaper'] {
  if (value === 'flat' || value === 'gradient' || value === 'underwater') return value;
  return DEFAULT_DESKTOP_PREFS.wallpaper;
}

function normalizePreviewStyle(value: string | null): DesktopPrefs['previewStyle'] {
  return value === 'tile' ? 'tile' : DEFAULT_DESKTOP_PREFS.previewStyle;
}

/** Load desktop prefs from localStorage (cached after first read). */
export function loadDesktopPrefs(): DesktopPrefs {
  if (cachedPrefs) return { ...cachedPrefs };
  const prefs: DesktopPrefs = {
    desktopLayout: normalizeLayout(readStorage(DESKTOP_PREFS_KEYS.desktopLayout)),
    wallpaper: normalizeWallpaper(readStorage(DESKTOP_PREFS_KEYS.wallpaper)),
    previewStyle: normalizePreviewStyle(readStorage(DESKTOP_PREFS_KEYS.previewStyle)),
  };
  cachedPrefs = prefs;
  return { ...prefs };
}

function emitDesktopPrefs(): void {
  const prefs = loadDesktopPrefs();
  for (const fn of listeners) {
    try {
      fn({ ...prefs });
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Persist all desktop prefs and notify subscribers. */
export function saveDesktopPrefs(prefs: DesktopPrefs): void {
  writeStorage(DESKTOP_PREFS_KEYS.desktopLayout, prefs.desktopLayout);
  writeStorage(DESKTOP_PREFS_KEYS.wallpaper, prefs.wallpaper);
  writeStorage(DESKTOP_PREFS_KEYS.previewStyle, prefs.previewStyle);
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
