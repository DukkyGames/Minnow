/**
 * Desktop appearance agent tools (get/update/upload).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { APPEARANCE_STORAGE_KEYS } from '../../src/appearance/types.ts';
import { DESKTOP_PREFS_KEYS } from '../../src/os/desktop-prefs.ts';
import {
  THEME_FAMILY_KEY,
  THEME_STORAGE_KEY,
} from '../../src/theme.ts';
import {
  resetAppearanceToolTestHooks,
  setAppearanceToolTestHooks,
  toolGetAppearance,
  toolUpdateAppearance,
  toolUploadAppearanceAsset,
} from '../../src/tools/appearance-tools.ts';

describe('appearance agent tools', () => {
  const prevLocalStorage = globalThis.localStorage;
  const prevDocument = globalThis.document;
  const prevWindow = globalThis.window;
  const store = new Map<string, string>();

  beforeEach(async () => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });

    const { Window } = await import('happy-dom');
    const win = new Window();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: win,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: win.document,
    });
    resetAppearanceToolTestHooks();
  });

  afterEach(() => {
    resetAppearanceToolTestHooks();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: prevLocalStorage,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: prevDocument,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: prevWindow,
    });
  });

  test('get_appearance returns expected shape from localStorage', () => {
    store.set(THEME_STORAGE_KEY, 'ocean-dark');
    store.set(THEME_FAMILY_KEY, 'ocean');
    store.set(DESKTOP_PREFS_KEYS.wallpaper, 'aurora');
    store.set(APPEARANCE_STORAGE_KEYS.customEnabled, '1');
    store.set(
      APPEARANCE_STORAGE_KEYS.customTokens,
      JSON.stringify({ bg: '#0a1628', fg: '#e8f0fe', accent: '#3b9eff', danger: '#ff6b6b' }),
    );

    const parsed = JSON.parse(toolGetAppearance()) as {
      theme: { family: string; mode: string; resolvedId: string };
      customColors: { enabled: boolean; seeds: Record<string, string> };
      wallpaper: { mode: string };
      fonts: { ui: { kind: string }; mono: { kind: string } };
    };

    assert.equal(parsed.theme.family, 'ocean');
    assert.equal(parsed.theme.mode, 'dark');
    assert.equal(parsed.theme.resolvedId, 'ocean-dark');
    assert.equal(parsed.customColors.enabled, true);
    assert.equal(parsed.customColors.seeds.bg, '#0a1628');
    assert.equal(parsed.wallpaper.mode, 'aurora');
    assert.equal(parsed.fonts.ui.kind, 'preset');
    assert.equal(parsed.fonts.mono.kind, 'preset');
  });

  test('update_appearance applies theme family and custom seeds', async () => {
    const raw = await toolUpdateAppearance({
      patch: {
        theme: { family: 'mint', mode: 'light' },
        customColors: {
          enabled: true,
          seeds: { bg: '#f5f5f5', fg: '#111111', accent: '#2ecc71', danger: '#e74c3c' },
        },
      },
    });
    const parsed = JSON.parse(raw) as { ok: boolean; applied: string[] };

    assert.equal(parsed.ok, true);
    assert.ok(parsed.applied.includes('theme.family=mint'));
    assert.ok(parsed.applied.includes('theme.mode=light'));
    assert.ok(parsed.applied.includes('customColors.seeds'));
    assert.equal(store.get(THEME_STORAGE_KEY), 'mint-light');
    assert.equal(store.get(APPEARANCE_STORAGE_KEYS.customEnabled), '1');
  });

  test('update_appearance merges custom token map', async () => {
    store.set(APPEARANCE_STORAGE_KEYS.customEnabled, '1');
    store.set(APPEARANCE_STORAGE_KEYS.customTokens, JSON.stringify({ bg: '#111111' }));

    const raw = await toolUpdateAppearance({
      patch: {
        customColors: {
          tokens: { accent: '#336699' },
        },
      },
    });
    const parsed = JSON.parse(raw) as { ok: boolean };
    assert.equal(parsed.ok, true);

    const tokens = JSON.parse(store.get(APPEARANCE_STORAGE_KEYS.customTokens) ?? '{}') as Record<
      string,
      string
    >;
    assert.equal(tokens.bg, '#111111');
    assert.equal(tokens.accent, '#336699');
  });

  test('update_appearance sets wallpaper mode', async () => {
    const raw = await toolUpdateAppearance({
      patch: { wallpaper: { mode: 'starfield', imageFit: 'contain' } },
    });
    const parsed = JSON.parse(raw) as { ok: boolean; applied: string[] };

    assert.equal(parsed.ok, true);
    assert.ok(parsed.applied.includes('wallpaper.mode=starfield'));
    assert.equal(store.get(DESKTOP_PREFS_KEYS.wallpaper), 'starfield');
    assert.equal(store.get(DESKTOP_PREFS_KEYS.wallpaperImageFit), 'contain');
  });

  test('update_appearance rejects invalid token keys', async () => {
    const raw = await toolUpdateAppearance({
      patch: { customColors: { tokens: { 'not-a-token': '#ffffff' } } },
    });
    const parsed = JSON.parse(raw) as { ok: boolean; errors: string[] };
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors[0], /Unknown token key/);
  });

  test('upload_appearance_asset rejects invalid path traversal', async () => {
    const result = await toolUploadAppearanceAsset({
      kind: 'wallpaper',
      path: '../outside.png',
    });
    assert.match(result, /Error: path must stay within the workspace/);
  });

  test('upload_appearance_asset rejects invalid wallpaper extension', async () => {
    setAppearanceToolTestHooks({
      serverAvailable: () => true,
      readWorkspaceFile: async () => ({
        bytes: new Uint8Array([1, 2, 3]).buffer,
        fileName: 'readme.txt',
      }),
    });

    const result = await toolUploadAppearanceAsset({
      kind: 'wallpaper',
      path: 'assets/readme.txt',
    });
    assert.match(result, /Error: wallpaper must be PNG, JPEG, or WebP/);
  });

  test('upload_appearance_asset happy path with mocked server read', async () => {
    setAppearanceToolTestHooks({
      serverAvailable: () => true,
      readWorkspaceFile: async () => ({
        bytes: new Uint8Array([137, 80, 78, 71]).buffer,
        fileName: 'bg.png',
      }),
      saveAsset: async () => 'asset-test-123',
    });

    const raw = await toolUploadAppearanceAsset({
      kind: 'wallpaper',
      path: 'assets/bg.png',
    });
    const parsed = JSON.parse(raw) as { ok: boolean; assetId: string; kind: string; name: string };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.assetId, 'asset-test-123');
    assert.equal(parsed.kind, 'wallpaper');
    assert.equal(parsed.name, 'bg.png');
  });
});
