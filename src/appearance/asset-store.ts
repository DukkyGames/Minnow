/**
 * IndexedDB store for appearance uploads (fonts, wallpaper images).
 */

import type { AppearanceAssetKind, AppearanceAssetRecord } from './types';

const DB_NAME = 'minnow-appearance';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

const MAX_WALLPAPER_BYTES = 5 * 1024 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;

const WALLPAPER_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FONT_MIMES = new Set([
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
  'application/font-woff2',
  'application/font-woff',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/octet-stream',
]);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('Failed to open appearance DB'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function newAssetId(): string {
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function inferFontMime(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'woff2') return 'font/woff2';
  if (ext === 'woff') return 'font/woff';
  if (ext === 'otf') return 'font/otf';
  if (ext === 'ttf') return 'font/ttf';
  return file.type || 'application/octet-stream';
}

/** Persist a font or wallpaper blob; returns the new asset id. */
export async function saveAppearanceAsset(
  kind: AppearanceAssetKind,
  file: File,
): Promise<string> {
  const maxBytes = kind === 'wallpaper' ? MAX_WALLPAPER_BYTES : MAX_FONT_BYTES;
  if (file.size > maxBytes) {
    throw new Error(
      `File exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`,
    );
  }

  const mime = kind === 'font' ? inferFontMime(file) : file.type;
  if (kind === 'wallpaper' && !WALLPAPER_MIMES.has(mime)) {
    throw new Error('Wallpaper must be JPEG, PNG, or WebP');
  }
  if (kind === 'font') {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const okExt = ['woff2', 'woff', 'ttf', 'otf'].includes(ext);
    if (!okExt && !FONT_MIMES.has(mime)) {
      throw new Error('Font must be WOFF2, WOFF, TTF, or OTF');
    }
  }

  const id = newAssetId();
  const record: AppearanceAssetRecord = {
    id,
    kind,
    mimeType: mime,
    name: file.name,
    blob: file,
    createdAt: new Date().toISOString(),
  };

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve(id);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save asset'));
    };
    tx.objectStore(STORE_NAME).put(record);
  });
}

/** Load one asset by id. */
export async function getAppearanceAsset(id: string): Promise<AppearanceAssetRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as AppearanceAssetRecord | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('Failed to read asset'));
    };
  });
}

/** Delete an asset from IndexedDB. */
export async function deleteAppearanceAsset(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to delete asset'));
    };
    tx.objectStore(STORE_NAME).delete(id);
  });
}

const objectUrlCache = new Map<string, string>();

/** Object URL for an asset (cached until revoked). */
export async function getAppearanceAssetObjectUrl(id: string): Promise<string | null> {
  const cached = objectUrlCache.get(id);
  if (cached) return cached;
  const record = await getAppearanceAsset(id);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  objectUrlCache.set(id, url);
  return url;
}

/** Revoke cached object URL for an asset. */
export function revokeAppearanceAssetObjectUrl(id: string): void {
  const url = objectUrlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(id);
  }
}

/** Clear object URL cache (tests). */
export function clearAppearanceAssetUrlCache(): void {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
}
