import {
  getCustomThemeTokens,
  isCustomThemeAdvanced,
  isCustomThemeEnabled,
  replaceCustomThemeTokens,
  setCustomThemeAdvanced,
  setCustomThemeEnabled,
  setCustomThemeTokens,
} from '../appearance/custom-theme';
import { parseCssColor } from '../appearance/color-format';
import { saveAppearanceAsset } from '../appearance/asset-store';
import {
  getAppearanceFonts,
  setMonoFont,
  setUiFont,
} from '../appearance/fonts';
import {
  deriveThemeTokensFromSeeds,
  extractSimplifiedSeeds,
  type SimplifiedThemeSeeds,
} from '../appearance/theme-derive';
import {
  CORE_THEME_TOKEN_KEYS,
  MONO_FONT_PRESETS,
  UI_FONT_PRESETS,
  type CoreThemeTokenKey,
  type CustomThemeTokens,
  type FontRef,
  type MonoFontPresetId,
  type UiFontPresetId,
} from '../appearance/types';
import { getLocalServerAvailable } from './client';
import {
  getFollowSystem,
  getStoredFamily,
  getStoredTheme,
  setFollowSystem,
  setThemeFamily,
  setThemeMode,
  THEME_FAMILIES,
  THEME_MODES,
  type ThemeFamily,
  type ThemeMode,
} from '../theme';
import { applyResolvedTheme } from '../ui/theme';

function dispatchAppearanceChanged(keys: string[]): void {
  try {
    window.dispatchEvent(
      new CustomEvent('minnow:settings-changed', { detail: { keys } }),
    );
  } catch {}
}

// ── Get ──────────────────────────────────────────────────────────────────────

/** Snapshot of current browser-local appearance state for agents. */
export function toolGetAppearance(): string {
  const themeId = getStoredTheme();
  const family = getFollowSystem() ? getStoredFamily() : getStoredTheme().split('-')[0];
  const mode = getFollowSystem()
    ? 'system'
    : themeId.endsWith('-light')
      ? 'light'
      : 'dark';

  const tokens = getCustomThemeTokens();

  return JSON.stringify(
    {
      theme: {
        family,
        mode,
        resolvedId: themeId,
      },
      customColors: {
        enabled: isCustomThemeEnabled(),
        advanced: isCustomThemeAdvanced(),
        seeds: extractSimplifiedSeeds(tokens),
        tokens,
      },
      fonts: getAppearanceFonts(),
    },
    null,
    2,
  );
}

interface UpdateAppearancePatch {
  theme?: { family?: string; mode?: string };
  customColors?: {
    enabled?: boolean;
    advanced?: boolean;
    seeds?: Partial<SimplifiedThemeSeeds>;
    tokens?: Record<string, string>;
    replaceTokens?: Record<string, string>;
  };
  fonts?: {
    ui?: string | FontUploadPatch;
    mono?: string | FontUploadPatch;
  };
}

interface FontUploadPatch {
  kind: 'upload';
  assetId: string;
  familyName?: string;
}

// ── Update ───────────────────────────────────────────────────────────────────

/** Apply a batch appearance patch and refresh the DOM. */
export async function toolUpdateAppearance(args: Record<string, unknown>): Promise<string> {
  const patch = (args.patch ?? args) as UpdateAppearancePatch;
  const applied: string[] = [];
  const errors: string[] = [];

  if (patch.theme) {
    if (patch.theme.family !== undefined) {
      const family = String(patch.theme.family).trim();
      if (!(THEME_FAMILIES as readonly string[]).includes(family)) {
        errors.push(`Invalid theme.family "${family}"`);
      } else {
        setThemeFamily(family as ThemeFamily);
        applied.push(`theme.family=${family}`);
      }
    }
    if (patch.theme.mode !== undefined) {
      const mode = String(patch.theme.mode).trim();
      if (mode === 'system') {
        setFollowSystem(true);
        applied.push('theme.mode=system');
      } else if ((THEME_MODES as readonly string[]).includes(mode as ThemeMode)) {
        setFollowSystem(false);
        setThemeMode(mode as ThemeMode);
        applied.push(`theme.mode=${mode}`);
      } else {
        errors.push(`Invalid theme.mode "${mode}"`);
      }
    }
  }

  if (patch.customColors) {
    const cc = patch.customColors;
    if (cc.enabled !== undefined) {
      setCustomThemeEnabled(Boolean(cc.enabled));
      applied.push(`customColors.enabled=${Boolean(cc.enabled)}`);
    }
    if (cc.advanced !== undefined) {
      setCustomThemeAdvanced(Boolean(cc.advanced));
      applied.push(`customColors.advanced=${Boolean(cc.advanced)}`);
    }
    if (cc.seeds && typeof cc.seeds === 'object') {
      const seedErr = validateSeeds(cc.seeds);
      if (seedErr) {
        errors.push(seedErr);
      } else {
        const merged = {
          ...extractSimplifiedSeeds(getCustomThemeTokens()),
          ...cc.seeds,
        } as SimplifiedThemeSeeds;
        const derived = deriveThemeTokensFromSeeds(merged);
        replaceCustomThemeTokens(derived);
        setCustomThemeEnabled(true);
        setCustomThemeAdvanced(false);
        applied.push('customColors.seeds');
      }
    }
    if (cc.replaceTokens && typeof cc.replaceTokens === 'object') {
      const { tokens, error } = parseTokenMap(cc.replaceTokens);
      if (error) {
        errors.push(error);
      } else {
        replaceCustomThemeTokens(tokens);
        setCustomThemeEnabled(true);
        applied.push('customColors.replaceTokens');
      }
    } else if (cc.tokens && typeof cc.tokens === 'object') {
      const { tokens, error } = parseTokenMap(cc.tokens);
      if (error) {
        errors.push(error);
      } else {
        setCustomThemeTokens(tokens);
        if (Object.keys(tokens).length) {
          setCustomThemeEnabled(true);
        }
        applied.push('customColors.tokens');
      }
    }
  }

  if (patch.fonts) {
    if (patch.fonts.ui !== undefined) {
      const ref = parseUiFontPatch(patch.fonts.ui);
      if ('error' in ref) {
        errors.push(ref.error);
      } else {
        setUiFont(ref.ref);
        applied.push('fonts.ui');
      }
    }
    if (patch.fonts.mono !== undefined) {
      const ref = parseMonoFontPatch(patch.fonts.mono);
      if ('error' in ref) {
        errors.push(ref.error);
      } else {
        setMonoFont(ref.ref);
        applied.push('fonts.mono');
      }
    }
  }

  applyResolvedTheme(getStoredTheme());
  dispatchAppearanceChanged(applied.map((a) => `appearance.${a}`));

  return JSON.stringify(
    {
      ok: errors.length === 0,
      applied,
      errors: errors.length ? errors : undefined,
    },
    null,
    2,
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────

/** Upload a workspace file into IndexedDB appearance storage. */
export async function toolUploadAppearanceAsset(
  args: Record<string, unknown>,
): Promise<string> {
  const kindRaw = args.kind;
  const pathRaw = args.path;
  if (kindRaw !== 'font') {
    return 'Error: "kind" must be "font"';
  }
  if (typeof pathRaw !== 'string' || !pathRaw.trim()) {
    return 'Error: "path" is required (workspace-relative file path)';
  }

  const relPath = normalizeWorkspacePath(pathRaw);
  if (relPath.includes('..')) {
    return 'Error: path must stay within the workspace';
  }

  if (!localServerAvailableImpl()) {
    return 'Error: Minnow is not running locally — open the app to read workspace files';
  }

  let bytes: ArrayBuffer;
  let fileName: string;
  try {
    const fetched = await readWorkspaceFileBytesImpl(relPath);
    bytes = fetched.bytes;
    fileName = fetched.fileName;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: could not read workspace file (${message})`;
  }

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!['woff2', 'woff', 'ttf', 'otf'].includes(ext)) {
    return 'Error: font must be WOFF2, WOFF, TTF, or OTF';
  }

  const mime = mimeForExtension(ext);
  const blob = new Blob([bytes], { type: mime });
  const file = new File([blob], fileName, { type: mime });

  let assetId: string;
  try {
    assetId = await saveAppearanceAssetImpl(kindRaw, file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }

  const slot = args.slot;
  if (slot === 'ui' || slot === 'mono') {
    const familyName =
      typeof args.familyName === 'string' && args.familyName.trim()
        ? args.familyName.trim()
        : fileName.replace(/\.[^.]+$/, '');
    if (slot === 'ui') {
      setUiFont({ kind: 'upload', slot: 'ui', assetId, familyName });
    } else {
      setMonoFont({ kind: 'upload', slot: 'mono', assetId, familyName });
    }
    applyResolvedTheme(getStoredTheme());
  }

  return JSON.stringify(
    {
      ok: true,
      assetId,
      kind: kindRaw,
      name: fileName,
    },
    null,
    2,
  );
}

function validateSeeds(seeds: Partial<SimplifiedThemeSeeds>): string | null {
  for (const key of ['bg', 'fg', 'accent', 'danger'] as const) {
    const value = seeds[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !parseCssColor(value.trim())) {
      return `Invalid customColors.seeds.${key} color "${String(value)}"`;
    }
  }
  return null;
}

function parseTokenMap(raw: Record<string, string>): {
  tokens: CustomThemeTokens;
  error?: string;
} {
  const tokens: CustomThemeTokens = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(CORE_THEME_TOKEN_KEYS as readonly string[]).includes(key)) {
      return { tokens: {}, error: `Unknown token key "${key}"` };
    }
    if (typeof value !== 'string' || !parseCssColor(value.trim())) {
      return { tokens: {}, error: `Invalid color for token "${key}"` };
    }
    tokens[key as CoreThemeTokenKey] = value.trim();
  }
  return { tokens };
}

function parseUiFontPatch(
  raw: unknown,
): { ref: Extract<FontRef, { slot: 'ui' }> } | { error: string } {
  return parseFontPatchForSlot('ui', raw) as
    | { ref: Extract<FontRef, { slot: 'ui' }> }
    | { error: string };
}

function parseMonoFontPatch(
  raw: unknown,
): { ref: Extract<FontRef, { slot: 'mono' }> } | { error: string } {
  return parseFontPatchForSlot('mono', raw) as
    | { ref: Extract<FontRef, { slot: 'mono' }> }
    | { error: string };
}

function parseFontPatchForSlot(
  slot: 'ui' | 'mono',
  raw: unknown,
): { ref: FontRef } | { error: string } {
  if (typeof raw === 'string') {
    const id = raw.trim();
    const presets = slot === 'ui' ? UI_FONT_PRESETS : MONO_FONT_PRESETS;
    if (!(presets as readonly string[]).includes(id)) {
      return { error: `Invalid ${slot} font preset "${id}"` };
    }
    if (slot === 'ui') {
      return { ref: { kind: 'preset', slot: 'ui', id: id as UiFontPresetId } };
    }
    return { ref: { kind: 'preset', slot: 'mono', id: id as MonoFontPresetId } };
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as FontUploadPatch;
    if (obj.kind === 'upload' && typeof obj.assetId === 'string' && obj.assetId.trim()) {
      return {
        ref: {
          kind: 'upload',
          slot,
          assetId: obj.assetId.trim(),
          familyName:
            typeof obj.familyName === 'string' && obj.familyName.trim()
              ? obj.familyName.trim()
              : `MinnowCustom${slot}`,
        },
      };
    }
  }

  return { error: `fonts.${slot} must be a preset id or { kind: "upload", assetId, familyName? }` };
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function mimeForExtension(ext: string): string {
  switch (ext) {
    case 'woff2':
      return 'font/woff2';
    case 'woff':
      return 'font/woff';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    default:
      return 'application/octet-stream';
  }
}

/** Read binary workspace file bytes via the local preview file route. */
async function readWorkspaceFileBytes(
  relativePath: string,
): Promise<{ bytes: ArrayBuffer; fileName: string }> {
  const encoded = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `/api/preview/file/${encoded}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`fetch failed (${message})`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  const fileName = relativePath.split('/').pop() ?? 'asset';
  return { bytes, fileName };
}

/** Test hooks for upload path (no IndexedDB in unit tests). */
let readWorkspaceFileBytesImpl = readWorkspaceFileBytes;
let saveAppearanceAssetImpl = saveAppearanceAsset;
let localServerAvailableImpl = getLocalServerAvailable;

// ── Tests ────────────────────────────────────────────────────────────────────

export function setAppearanceToolTestHooks(hooks: {
  readWorkspaceFile?: typeof readWorkspaceFileBytes;
  saveAsset?: typeof saveAppearanceAsset;
  serverAvailable?: () => boolean;
}): void {
  readWorkspaceFileBytesImpl = hooks.readWorkspaceFile ?? readWorkspaceFileBytes;
  saveAppearanceAssetImpl = hooks.saveAsset ?? saveAppearanceAsset;
  localServerAvailableImpl = hooks.serverAvailable ?? getLocalServerAvailable;
}

export function resetAppearanceToolTestHooks(): void {
  readWorkspaceFileBytesImpl = readWorkspaceFileBytes;
  saveAppearanceAssetImpl = saveAppearanceAsset;
  localServerAvailableImpl = getLocalServerAvailable;
}

