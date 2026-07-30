/**
 * Wallpaper mode normalization and catalog.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  DEFAULT_DESKTOP_PREFS,
  loadDesktopPrefs,
  resetDesktopPrefsForTests,
  saveDesktopPref,
} from '../../src/os/desktop-prefs.ts';
import { WALLPAPER_CATALOG } from '../../src/os/wallpaper.ts';

const storage = new Map<string, string>();

function mockLocalStorage(): void {
  (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
}

afterEach(() => {
  storage.clear();
  resetDesktopPrefsForTests();
});

describe('wallpaper prefs', () => {
  test('default wallpaper is underwater', () => {
    mockLocalStorage();
    assert.equal(loadDesktopPrefs().wallpaper, 'underwater');
    assert.equal(DEFAULT_DESKTOP_PREFS.wallpaper, 'underwater');
  });

  test('unknown wallpaper migrates to underwater', () => {
    mockLocalStorage();
    storage.set('minnow.os.wallpaper', 'invalid-mode');
    assert.equal(loadDesktopPrefs().wallpaper, 'underwater');
  });

  test('saveDesktopPref persists minnow mode', () => {
    mockLocalStorage();
    saveDesktopPref('wallpaper', 'minnow');
    assert.equal(loadDesktopPrefs().wallpaper, 'minnow');
  });

  test('catalog includes signature minnow and custom modes', () => {
    const ids = WALLPAPER_CATALOG.map((w) => w.id);
    assert.ok(ids.includes('minnow'));
    assert.ok(ids.includes('custom'));
    assert.ok(ids.includes('underwater'));
    assert.ok(ids.includes('gradient'));
    assert.ok(!ids.includes('mesh'));
    assert.ok(!ids.includes('grain'));
  });

  test('retired mesh and grain aliases migrate on load', () => {
    mockLocalStorage();
    storage.set('minnow.os.wallpaper', 'mesh');
    assert.equal(loadDesktopPrefs().wallpaper, 'gradient');
    assert.equal(storage.get('minnow.os.wallpaper'), 'gradient');

    storage.clear();
    resetDesktopPrefsForTests();
    mockLocalStorage();
    storage.set('minnow.os.wallpaper', 'grain');
    assert.equal(loadDesktopPrefs().wallpaper, 'flat');
    assert.equal(storage.get('minnow.os.wallpaper'), 'flat');
  });
});