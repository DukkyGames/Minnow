import type { DesktopPrefs } from './types';
import type { WallpaperImageFit, WallpaperMode } from './wallpaper';

const STORAGE_PREFIX = 'minnow.os.';

export const DESKTOP_PREFS_KEYS = {
  desktopLayout: `${STORAGE_PREFIX}desktopLayout`,
  wallpaper: `${STORAGE_PREFIX}wallpaper`,
  wallpaperImageId: `${STORAGE_PREFIX}wallpaperImageId`,
  wallpaperImageFit: `${STORAGE_PREFIX}wallpaperImageFit`,
} as const;

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = {
  desktopLayout: 'dock',
  wallpaper: 'underwater',
  wallpaperImageFit: 'cover',
};

type DesktopPrefsListener = (prefs: DesktopPrefs) => void;

const listeners = new Set<DesktopPrefsListener>();
let cachedPrefs: DesktopPrefs | null = null;

const WALLPAPER_MODES = new Set<WallpaperMode>([
  'flat',
  'gradient',
  'underwater',
  'minnow',
  'aurora',
  'starfield',
  'grain',
  'mesh',
  'custom',
]);

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

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

function normalizeLayout(value: string | null): DesktopPrefs['desktopLayout'] {
  if (value === 'grid' || value === 'concierge' || value === 'dock') return 'dock';
  return DEFAULT_DESKTOP_PREFS.desktopLayout;
}

function normalizeWallpaper(value: string | null): WallpaperMode {
  if (value && WALLPAPER_MODES.has(value as WallpaperMode)) {
    return value as WallpaperMode;
  }
  return DEFAULT_DESKTOP_PREFS.wallpaper;
}

function normalizeImageFit(value: string | null): WallpaperImageFit {
  return value === 'contain' ? 'contain' : 'cover';
}

/** Load desktop prefs from localStorage (cached after first read). */
export function loadDesktopPrefs(): DesktopPrefs {
  if (cachedPrefs) return { ...cachedPrefs };

  const rawLayout = readStorage(DESKTOP_PREFS_KEYS.desktopLayout);
  const desktopLayout = normalizeLayout(rawLayout);
  if (rawLayout && rawLayout !== desktopLayout) {
    writeStorage(DESKTOP_PREFS_KEYS.desktopLayout, desktopLayout);
  }

  const wallpaperImageId = readStorage(DESKTOP_PREFS_KEYS.wallpaperImageId) ?? undefined;
  const prefs: DesktopPrefs = {
    desktopLayout,
    wallpaper: normalizeWallpaper(readStorage(DESKTOP_PREFS_KEYS.wallpaper)),
    wallpaperImageId: wallpaperImageId || undefined,
    wallpaperImageFit: normalizeImageFit(readStorage(DESKTOP_PREFS_KEYS.wallpaperImageFit)),
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
  writeStorage(DESKTOP_PREFS_KEYS.wallpaperImageFit, prefs.wallpaperImageFit ?? 'cover');
  if (prefs.wallpaperImageId) {
    writeStorage(DESKTOP_PREFS_KEYS.wallpaperImageId, prefs.wallpaperImageId);
  } else {
    removeStorage(DESKTOP_PREFS_KEYS.wallpaperImageId);
  }
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
