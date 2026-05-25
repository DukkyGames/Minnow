/**
 * Eight palette themes (4 families × dark/light), persistence, and DOM application.
 */

export const THEME_STORAGE_KEY = 'minnow.theme';
export const THEME_FOLLOW_SYSTEM_KEY = 'minnow.theme.followSystem';
export const THEME_FAMILY_KEY = 'minnow.theme.family';

export const THEME_FAMILIES = ['sage', 'amber', 'cyan', 'coral'] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];

export const THEME_MODES = ['dark', 'light'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export type ThemeId = `${ThemeFamily}-${ThemeMode}`;

const THEME_ID_RE = /^(sage|amber|cyan|coral)-(dark|light)$/;

export interface ThemeFamilyMeta {
  id: ThemeFamily;
  name: string;
  blurb: string;
}

export const THEME_FAMILY_META: ThemeFamilyMeta[] = [
  {
    id: 'sage',
    name: 'Slate · Sage',
    blurb: 'Cool neutrals, muted sage accent. Calm and editor-like.',
  },
  {
    id: 'amber',
    name: 'Stone · Amber',
    blurb: 'Warm taupe neutrals with an amber accent. Cozy for long sessions.',
  },
  {
    id: 'cyan',
    name: 'Cyan · Midnight',
    blurb: 'Blue-tinted neutrals with a soft cyan accent. Modern dev-tool feel.',
  },
  {
    id: 'coral',
    name: 'Graphite · Coral',
    blurb: 'True graphite neutrals with a warm coral accent. Distinct and soft-modern.',
  },
];

/** Default when storage is empty or invalid. */
export const DEFAULT_THEME_ID: ThemeId = 'sage-dark';
export const DEFAULT_THEME_FAMILY: ThemeFamily = 'sage';

function isThemeFamily(v: string | null): v is ThemeFamily {
  return v === 'sage' || v === 'amber' || v === 'cyan' || v === 'coral';
}

function isThemeId(v: string | null): v is ThemeId {
  return typeof v === 'string' && THEME_ID_RE.test(v);
}

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

function systemPrefersLight(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(prefers-color-scheme: light)').matches;
}

function resolveModeForFamily(family: ThemeFamily): ThemeMode {
  return systemPrefersLight() ? 'light' : 'dark';
}

function composeThemeId(family: ThemeFamily, mode: ThemeMode): ThemeId {
  return `${family}-${mode}`;
}

/** One-time migration from legacy light | dark | system values. */
function migrateLegacyThemeStorage(): void {
  const raw = readStorage(THEME_STORAGE_KEY);
  if (raw === 'light') {
    writeStorage(THEME_STORAGE_KEY, 'sage-light');
    removeStorage(THEME_FOLLOW_SYSTEM_KEY);
    return;
  }
  if (raw === 'dark') {
    writeStorage(THEME_STORAGE_KEY, 'sage-dark');
    removeStorage(THEME_FOLLOW_SYSTEM_KEY);
    return;
  }
  if (raw === 'system') {
    writeStorage(THEME_FOLLOW_SYSTEM_KEY, '1');
    writeStorage(THEME_FAMILY_KEY, DEFAULT_THEME_FAMILY);
    removeStorage(THEME_STORAGE_KEY);
  }
}

export function getFollowSystem(): boolean {
  return readStorage(THEME_FOLLOW_SYSTEM_KEY) === '1';
}

/** Family from follow-system storage, or derived from the explicit theme id. */
export function getStoredFamily(): ThemeFamily {
  if (!getFollowSystem()) {
    return getFamily(getStoredTheme());
  }
  const raw = readStorage(THEME_FAMILY_KEY);
  if (isThemeFamily(raw)) return raw;
  return DEFAULT_THEME_FAMILY;
}

/** Effective theme id from localStorage (includes follow-system + migration). */
export function getStoredTheme(): ThemeId {
  migrateLegacyThemeStorage();

  if (getFollowSystem()) {
    const family = getStoredFamily();
    return composeThemeId(family, resolveModeForFamily(family));
  }

  const raw = readStorage(THEME_STORAGE_KEY);
  if (isThemeId(raw)) return raw;
  return DEFAULT_THEME_ID;
}

export function getFamily(id: ThemeId): ThemeFamily {
  return id.split('-')[0] as ThemeFamily;
}

export function getMode(id: ThemeId): ThemeMode {
  return id.endsWith('-light') ? 'light' : 'dark';
}

function updateThemeColorMeta(id: ThemeId): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--mn-bg').trim();
  if (bg) meta.setAttribute('content', bg);
  else meta.setAttribute('content', getMode(id) === 'dark' ? '#0f1216' : '#f7f7f4');
}

let systemListener: MediaQueryList | null = null;
let onSystemChange: (() => void) | null = null;

function detachSystemListener(): void {
  if (systemListener && onSystemChange) {
    systemListener.removeEventListener('change', onSystemChange);
  }
  systemListener = null;
  onSystemChange = null;
}

function attachSystemListener(): void {
  detachSystemListener();
  if (typeof globalThis.matchMedia !== 'function') return;
  systemListener = globalThis.matchMedia('(prefers-color-scheme: light)');
  onSystemChange = () => {
    if (!getFollowSystem()) return;
    applyTheme(getStoredTheme(), { persist: false });
  };
  systemListener.addEventListener('change', onSystemChange);
}

export function syncThemeListeners(): void {
  if (getFollowSystem()) attachSystemListener();
  else detachSystemListener();
}

export interface ApplyThemeOptions {
  /** When false, only updates DOM (used when OS mode changes under follow-system). */
  persist?: boolean;
}

const BOOT_INLINE_THEME_VARS = ['--mn-bg', '--mn-fg', '--mn-accent', '--mn-border'] as const;

/** Remove FOUC boot inline tokens so stylesheet theme blocks can apply. */
function clearBootInlineThemeVars(root: HTMLElement): void {
  for (const name of BOOT_INLINE_THEME_VARS) {
    root.style.removeProperty(name);
  }
}

/** Set data-theme, color-scheme, meta theme-color; optionally persist explicit choice. */
export function applyTheme(id: ThemeId, options: ApplyThemeOptions = {}): void {
  const { persist = true } = options;
  const root = document.documentElement;
  clearBootInlineThemeVars(root);
  root.setAttribute('data-theme', id);
  root.style.colorScheme = getMode(id);
  updateThemeColorMeta(id);

  if (persist && !getFollowSystem()) {
    writeStorage(THEME_STORAGE_KEY, id);
    removeStorage(THEME_FOLLOW_SYSTEM_KEY);
  }
}

export function setFollowSystem(enabled: boolean): void {
  const family = getFollowSystem() ? getStoredFamily() : getFamily(getStoredTheme());
  if (enabled) {
    writeStorage(THEME_FOLLOW_SYSTEM_KEY, '1');
    writeStorage(THEME_FAMILY_KEY, family);
    removeStorage(THEME_STORAGE_KEY);
    syncThemeListeners();
    applyTheme(composeThemeId(family, resolveModeForFamily(family)), { persist: false });
    return;
  }
  removeStorage(THEME_FOLLOW_SYSTEM_KEY);
  const mode = resolveModeForFamily(family);
  const id = composeThemeId(family, mode);
  writeStorage(THEME_STORAGE_KEY, id);
  syncThemeListeners();
  applyTheme(id);
}

export function setThemeFamily(family: ThemeFamily): void {
  if (getFollowSystem()) {
    writeStorage(THEME_FAMILY_KEY, family);
    syncThemeListeners();
    applyTheme(composeThemeId(family, resolveModeForFamily(family)), { persist: false });
    return;
  }
  const mode = getMode(getStoredTheme());
  const id = composeThemeId(family, mode);
  applyTheme(id);
}

export function setThemeMode(mode: ThemeMode): void {
  const family = getFollowSystem() ? getStoredFamily() : getFamily(getStoredTheme());
  if (getFollowSystem()) {
    setFollowSystem(false);
  }
  applyTheme(composeThemeId(family, mode));
}

/** Call once after DOM exists; removes FOUC guard class after first paint. */
export function initTheme(): void {
  document.documentElement.classList.add('theme-no-transition');
  const id = getStoredTheme();
  syncThemeListeners();
  applyTheme(id, { persist: false });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-no-transition');
      document.documentElement.classList.add('theme-ready');
    });
  });

  if (import.meta.env.DEV) {
    (globalThis as typeof globalThis & { __setTheme?: (id: ThemeId) => void }).__setTheme =
      applyTheme;
  }
}

/** @deprecated Use getStoredTheme — kept for callers expecting light|dark. */
export type LegacyThemePreference = 'light' | 'dark' | 'system';

export function getThemePreference(): LegacyThemePreference {
  if (getFollowSystem()) return 'system';
  return getMode(getStoredTheme());
}

export function setThemePreference(pref: LegacyThemePreference): void {
  if (pref === 'system') {
    setFollowSystem(true);
    return;
  }
  const family = getFamily(getStoredTheme());
  setFollowSystem(false);
  applyTheme(composeThemeId(family, pref));
}

export function resolveTheme(pref?: LegacyThemePreference): ThemeMode {
  if (pref === 'light' || pref === 'dark') return pref;
  if (pref === 'system' || getFollowSystem()) {
    return resolveModeForFamily(getStoredFamily());
  }
  return getMode(getStoredTheme());
}
