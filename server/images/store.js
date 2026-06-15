/**
 * Gallery metadata + file storage under ~/.minnow/gallery/.
 * Uses a JSON index (v1) with a documented SQLite migration path.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureMinnowLayout } from '../config/home.js';
import { readResource } from '../config/store.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';
import { galleryImagesDir, galleryIndexPath } from './paths.js';

/** Default album id for generated images. */
export const DEFAULT_ALBUM_ID = 'generated';

/** Serialize writes so API + cleanup cannot clobber each other. */
let writeQueue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withWriteLock(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * @param {string} filePath
 * @param {unknown} data
 */
async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * @typedef {object} GalleryAlbum
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 */

/**
 * @typedef {object} GalleryImage
 * @property {string} id
 * @property {string} albumId
 * @property {string} prompt
 * @property {string} [negativePrompt]
 * @property {string} [providerId]
 * @property {string} [model]
 * @property {Record<string, unknown>} params
 * @property {string} filePath
 * @property {string} [thumbnailPath]
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} createdAt
 * @property {'generated' | 'imported'} provenance
 */

/**
 * @typedef {object} GalleryIndex
 * @property {number} version
 * @property {GalleryAlbum[]} albums
 * @property {GalleryImage[]} images
 */

const INDEX_VERSION = 1;

/**
 * @returns {GalleryIndex}
 */
function emptyIndex() {
  const now = new Date().toISOString();
  return {
    version: INDEX_VERSION,
    albums: [{ id: DEFAULT_ALBUM_ID, name: 'Generated', createdAt: now }],
    images: [],
  };
}

/**
 * @returns {Promise<GalleryIndex>}
 */
async function readIndex() {
  await ensureMinnowLayout();
  await fs.mkdir(galleryImagesDir(), { recursive: true });
  const filePath = galleryIndexPath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return emptyIndex();
    }
    const albums = Array.isArray(parsed.albums) ? parsed.albums : [];
    const images = Array.isArray(parsed.images) ? parsed.images : [];
    if (!albums.some((a) => a?.id === DEFAULT_ALBUM_ID)) {
      albums.unshift({
        id: DEFAULT_ALBUM_ID,
        name: 'Generated',
        createdAt: new Date().toISOString(),
      });
    }
    return {
      version: INDEX_VERSION,
      albums,
      images,
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      const index = emptyIndex();
      await writeJsonAtomic(filePath, index);
      return index;
    }
    throw err;
  }
}

/**
 * @param {GalleryIndex} index
 */
async function writeIndex(index) {
  await writeJsonAtomic(galleryIndexPath(), {
    version: INDEX_VERSION,
    albums: index.albums,
    images: index.images,
  });
}

/**
 * Load images config from ~/.minnow/config.json meta.
 */
export async function loadImagesConfig() {
  const meta = await readResource('meta');
  const images = meta?.images && typeof meta.images === 'object' ? meta.images : {};
  return {
    defaultProviderId: String(images.defaultProviderId ?? '').trim() || undefined,
    defaultModel: String(images.defaultModel ?? 'dall-e-3').trim(),
    defaultSize: String(images.defaultSize ?? '1024x1024').trim(),
    defaultCount: Number(images.defaultCount ?? 1) || 1,
    maxFileBytes: Number(images.maxFileBytes ?? 10 * 1024 * 1024) || 10 * 1024 * 1024,
    maxGalleryBytes: Number(images.maxGalleryBytes ?? 1024 * 1024 * 1024) || 1024 * 1024 * 1024,
    maxImages: Number(images.maxImages ?? 500) || 500,
  };
}

/**
 * Resolve an image file path and verify it stays under gallery/images/.
 * @param {string} relativePath
 */
export function resolveGalleryImagePath(relativePath) {
  const raw = String(relativePath ?? '').trim();
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw new Error('Invalid image path');
  }
  const safeName = path.basename(raw);
  if (!safeName || safeName !== raw) {
    throw new Error('Invalid image path');
  }
  if (!/^[a-zA-Z0-9._-]+\.png$/i.test(safeName)) {
    throw new Error('Invalid image path');
  }
  const imagesDir = galleryImagesDir();
  const resolved = path.resolve(imagesDir, safeName);
  if (!isResolvedPathUnderRoot(resolved, imagesDir)) {
    throw new Error('Path traversal rejected');
  }
  return resolved;
}

/**
 * @returns {Promise<GalleryAlbum[]>}
 */
export async function listAlbums() {
  const index = await readIndex();
  return index.albums;
}

/**
 * @param {{ name: string }} input
 * @returns {Promise<GalleryAlbum>}
 */
export async function createAlbum(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) {
    throw new Error('name is required');
  }
  return withWriteLock(async () => {
    const index = await readIndex();
    const album = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    index.albums.push(album);
    await writeIndex(index);
    return album;
  });
}

/**
 * @param {{ albumId?: string, limit?: number, offset?: number }} [query]
 * @returns {Promise<{ images: GalleryImage[], total: number }>}
 */
export async function listImages(query = {}) {
  const index = await readIndex();
  let rows = [...index.images];
  const albumId = query.albumId ? String(query.albumId).trim() : '';
  if (albumId) {
    rows = rows.filter((img) => img.albumId === albumId);
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = rows.length;
  const offset = Math.max(0, Number(query.offset ?? 0) || 0);
  const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));
  return { images: rows.slice(offset, offset + limit), total };
}

/**
 * @param {string} id
 * @returns {Promise<GalleryImage | null>}
 */
export async function getImageById(id) {
  const index = await readIndex();
  return index.images.find((img) => img.id === id) ?? null;
}

/**
 * @param {object} input
 * @returns {Promise<GalleryImage>}
 */
export async function saveImageBytes(input) {
  const {
    bytes,
    prompt,
    negativePrompt,
    providerId,
    model,
    params = {},
    albumId = DEFAULT_ALBUM_ID,
    provenance = 'generated',
    width,
    height,
  } = input;

  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error('Image bytes are required');
  }

  const config = await loadImagesConfig();
  if (bytes.length > config.maxFileBytes) {
    throw new Error(`Image exceeds maxFileBytes (${config.maxFileBytes})`);
  }

  const promptText = String(prompt ?? '').trim();
  if (!promptText) {
    throw new Error('prompt is required');
  }

  return withWriteLock(async () => {
    const index = await readIndex();
    if (!index.albums.some((a) => a.id === albumId)) {
      throw new Error(`Album not found: ${albumId}`);
    }

    const id = randomUUID();
    const fileName = `${id}.png`;
    const filePath = path.join(galleryImagesDir(), fileName);
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.mkdir(galleryImagesDir(), { recursive: true });
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, filePath);

    const image = {
      id,
      albumId,
      prompt: promptText,
      ...(negativePrompt ? { negativePrompt: String(negativePrompt) } : {}),
      ...(providerId ? { providerId: String(providerId) } : {}),
      ...(model ? { model: String(model) } : {}),
      params: params && typeof params === 'object' ? { ...params } : {},
      filePath: fileName,
      ...(width ? { width: Number(width) } : {}),
      ...(height ? { height: Number(height) } : {}),
      createdAt: new Date().toISOString(),
      provenance: provenance === 'imported' ? 'imported' : 'generated',
    };

    index.images.push(image);
    await writeIndex(index);
    await enforceCapsUnlocked();
    return image;
  });
}

/**
 * @param {string} id
 */
export async function deleteImage(id) {
  return withWriteLock(async () => {
    const index = await readIndex();
    const image = index.images.find((img) => img.id === id);
    if (!image) {
      throw new Error('Image not found');
    }

    try {
      const abs = resolveGalleryImagePath(image.filePath);
      await fs.unlink(abs);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        throw err;
      }
    }

    index.images = index.images.filter((img) => img.id !== id);
    await writeIndex(index);
    return { ok: true };
  });
}

/**
 * Delete oldest images when over maxImages or maxGalleryBytes (caller must hold write lock).
 * @returns {Promise<{ deletedIds: string[], freedBytes: number }>}
 */
async function enforceCapsUnlocked() {
  const config = await loadImagesConfig();
  const index = await readIndex();
  const sorted = [...index.images].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)),
  );

  let totalBytes = 0;
  const sizes = new Map();
  for (const img of sorted) {
    try {
      const abs = resolveGalleryImagePath(img.filePath);
      const stat = await fs.stat(abs);
      sizes.set(img.id, stat.size);
      totalBytes += stat.size;
    } catch {
      sizes.set(img.id, 0);
    }
  }

  const deletedIds = [];
  let freedBytes = 0;

  const tryDelete = async (img) => {
    try {
      const abs = resolveGalleryImagePath(img.filePath);
      await fs.unlink(abs);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        throw err;
      }
    }
    deletedIds.push(img.id);
    freedBytes += sizes.get(img.id) ?? 0;
    totalBytes -= sizes.get(img.id) ?? 0;
    index.images = index.images.filter((row) => row.id !== img.id);
  };

  while (index.images.length > config.maxImages && sorted.length > 0) {
    const oldest = sorted.shift();
    if (!oldest || deletedIds.includes(oldest.id)) continue;
    await tryDelete(oldest);
  }

  while (totalBytes > config.maxGalleryBytes && sorted.length > 0) {
    const oldest = sorted.shift();
    if (!oldest || deletedIds.includes(oldest.id)) continue;
    await tryDelete(oldest);
  }

  if (deletedIds.length > 0) {
    await writeIndex(index);
  }

  return { deletedIds, freedBytes };
}

/**
 * Delete oldest images when over maxImages or maxGalleryBytes.
 * @returns {Promise<{ deletedIds: string[], freedBytes: number }>}
 */
export async function enforceCaps() {
  return withWriteLock(() => enforceCapsUnlocked());
}

/**
 * Gallery disk usage summary.
 */
export async function getGalleryStats() {
  const index = await readIndex();
  const config = await loadImagesConfig();
  let totalBytes = 0;
  for (const img of index.images) {
    try {
      const abs = resolveGalleryImagePath(img.filePath);
      const stat = await fs.stat(abs);
      totalBytes += stat.size;
    } catch {
      // missing file — skip
    }
  }
  return {
    imageCount: index.images.length,
    albumCount: index.albums.length,
    totalBytes,
    maxImages: config.maxImages,
    maxGalleryBytes: config.maxGalleryBytes,
    maxFileBytes: config.maxFileBytes,
  };
}

/** Reset write queue (tests). */
export function resetGalleryStoreForTests() {
  writeQueue = Promise.resolve();
}
