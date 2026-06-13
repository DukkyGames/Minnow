/**
 * UI and monospace font presets, uploads, and CSS variable application.
 */

import { getAppearanceAsset, getAppearanceAssetObjectUrl } from './asset-store';
import {
  APPEARANCE_STORAGE_KEYS,
  DEFAULT_APPEARANCE_FONTS,
  MONO_FONT_PRESETS,
  UI_FONT_PRESETS,
  type AppearanceFonts,
  type FontRef,
  type MonoFontPresetId,
  type UiFontPresetId,
} from './types';

export { MONO_FONT_PRESETS, UI_FONT_PRESETS };

const SYSTEM_UI =
  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SYSTEM_MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/** CSS font-family stacks for built-in presets. */
export const UI_FONT_STACKS: Record<UiFontPresetId, string> = {
  system: SYSTEM_UI,
  inter: "'Inter', " + SYSTEM_UI,
  geist: "'Geist', " + SYSTEM_UI,
  'ibm-plex-sans': "'IBM Plex Sans', " + SYSTEM_UI,
};

export const MONO_FONT_STACKS: Record<MonoFontPresetId, string> = {
  system: "'JetBrains Mono', " + SYSTEM_MONO,
  'jetbrains-mono': "'JetBrains Mono', " + SYSTEM_MONO,
  'geist-mono': "'Geist Mono', " + SYSTEM_MONO,
  'ibm-plex-mono': "'IBM Plex Mono', " + SYSTEM_MONO,
};

export const UI_FONT_LABELS: Record<UiFontPresetId, string> = {
  system: 'System',
  inter: 'Inter',
  geist: 'Geist Sans',
  'ibm-plex-sans': 'IBM Plex Sans',
};

export const MONO_FONT_LABELS: Record<MonoFontPresetId, string> = {
  system: 'System mono',
  'jetbrains-mono': 'JetBrains Mono',
  'geist-mono': 'Geist Mono',
  'ibm-plex-mono': 'IBM Plex Mono',
};

const registeredUploadFonts = new Map<string, FontFace>();

type FontListener = () => void;
const listeners = new Set<FontListener>();

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

function emitChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function isUiPreset(id: string): id is UiFontPresetId {
  return id in UI_FONT_STACKS;
}

function isMonoPreset(id: string): id is MonoFontPresetId {
  return id in MONO_FONT_STACKS;
}

function parseFontRef(raw: unknown, slot: 'ui' | 'mono'): FontRef {
  if (!raw || typeof raw !== 'object') {
    return slot === 'ui' ? DEFAULT_APPEARANCE_FONTS.ui : DEFAULT_APPEARANCE_FONTS.mono;
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'upload' && typeof obj.assetId === 'string') {
    return {
      kind: 'upload',
      slot,
      assetId: obj.assetId,
      familyName:
        typeof obj.familyName === 'string' ? obj.familyName : `MinnowCustom${slot}`,
    };
  }
  if (obj.kind === 'preset' && typeof obj.id === 'string') {
    if (slot === 'ui' && isUiPreset(obj.id)) {
      return { kind: 'preset', slot: 'ui', id: obj.id };
    }
    if (slot === 'mono' && isMonoPreset(obj.id)) {
      return { kind: 'preset', slot: 'mono', id: obj.id };
    }
  }
  return slot === 'ui' ? DEFAULT_APPEARANCE_FONTS.ui : DEFAULT_APPEARANCE_FONTS.mono;
}

/** Load font preferences from localStorage. */
export function getAppearanceFonts(): AppearanceFonts {
  const raw = readStorage(APPEARANCE_STORAGE_KEYS.fonts);
  if (!raw) return { ...DEFAULT_APPEARANCE_FONTS };
  try {
    const data = JSON.parse(raw) as { ui?: unknown; mono?: unknown };
    return {
      ui: parseFontRef(data.ui, 'ui'),
      mono: parseFontRef(data.mono, 'mono'),
    };
  } catch {
    return { ...DEFAULT_APPEARANCE_FONTS };
  }
}

/** Persist font preferences. */
export function setAppearanceFonts(fonts: AppearanceFonts): void {
  writeStorage(APPEARANCE_STORAGE_KEYS.fonts, JSON.stringify(fonts));
  emitChange();
}

function stackForRef(ref: FontRef): string {
  if (ref.kind === 'preset') {
    return ref.slot === 'ui' ? UI_FONT_STACKS[ref.id] : MONO_FONT_STACKS[ref.id];
  }
  const family = ref.familyName.replace(/['"]/g, '');
  const fallback = ref.slot === 'ui' ? SYSTEM_UI : SYSTEM_MONO;
  return `'${family}', ${fallback}`;
}

async function ensureUploadFontLoaded(ref: FontRef & { kind: 'upload' }): Promise<void> {
  const cacheKey = `${ref.slot}:${ref.assetId}`;
  if (registeredUploadFonts.has(cacheKey)) return;

  const asset = await getAppearanceAsset(ref.assetId);
  if (!asset) return;

  const url = await getAppearanceAssetObjectUrl(ref.assetId);
  if (!url) return;

  const family = ref.familyName.replace(/['"]/g, '');
  const face = new FontFace(family, `url(${url})`);
  try {
    const loaded = await face.load();
    document.fonts.add(loaded);
    registeredUploadFonts.set(cacheKey, loaded);
  } catch {
    /* fall back to preset stack */
  }
}

/** Apply --font-ui and --font-mono on documentElement. */
export async function applyAppearanceFonts(fonts?: AppearanceFonts): Promise<void> {
  const prefs = fonts ?? getAppearanceFonts();
  const root = document.documentElement;

  if (prefs.ui.kind === 'upload') {
    await ensureUploadFontLoaded(prefs.ui);
  }
  if (prefs.mono.kind === 'upload') {
    await ensureUploadFontLoaded(prefs.mono);
  }

  root.style.setProperty('--font-ui', stackForRef(prefs.ui));
  root.style.setProperty('--font-mono', stackForRef(prefs.mono));
  emitChange();
}

/** Set UI font preset or upload ref. */
export function setUiFont(ref: FontRef & { slot: 'ui' }): void {
  const fonts = getAppearanceFonts();
  fonts.ui = ref;
  setAppearanceFonts(fonts);
  void applyAppearanceFonts(fonts);
}

/** Set mono font preset or upload ref. */
export function setMonoFont(ref: FontRef & { slot: 'mono' }): void {
  const fonts = getAppearanceFonts();
  fonts.mono = ref;
  setAppearanceFonts(fonts);
  void applyAppearanceFonts(fonts);
}

/** Subscribe to font preference changes. */
export function subscribeAppearanceFonts(listener: FontListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clear registered upload fonts (tests). */
export function resetAppearanceFontsForTests(): void {
  registeredUploadFonts.clear();
  removeStorage(APPEARANCE_STORAGE_KEYS.fonts);
  listeners.clear();
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}
