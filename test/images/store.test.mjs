/**
 * Gallery store CRUD, cap enforcement, and metadata tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../server/config/home.js';
import {
  DEFAULT_ALBUM_ID,
  createAlbum,
  deleteImage,
  enforceCaps,
  getImageById,
  listAlbums,
  listImages,
  resetGalleryStoreForTests,
  saveImageBytes,
} from '../../server/images/store.js';

/** Minimal valid PNG (1x1). */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** @type {string} */
let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-gallery-store-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  resetGalleryStoreForTests();
  await ensureMinnowLayout();
  await fs.writeFile(
    path.join(homeDir, 'config.json'),
    JSON.stringify({
      schemaVersion: 1,
      images: {
        defaultModel: 'dall-e-3',
        defaultSize: '1024x1024',
        defaultCount: 1,
        maxFileBytes: 1048576,
        maxGalleryBytes: 500000,
        maxImages: 3,
      },
    }),
    'utf8',
  );
});

after(async () => {
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  resetGalleryStoreForTests();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('gallery store', () => {
  test('creates default Generated album on first read', async () => {
    const albums = await listAlbums();
    assert.ok(albums.some((a) => a.id === DEFAULT_ALBUM_ID));
    assert.equal(albums.find((a) => a.id === DEFAULT_ALBUM_ID)?.name, 'Generated');
  });

  test('saves image bytes and metadata', async () => {
    const image = await saveImageBytes({
      bytes: PNG_BYTES,
      prompt: 'A red circle on white',
      provenance: 'generated',
    });

    assert.ok(image.id);
    assert.equal(image.prompt, 'A red circle on white');
    assert.equal(image.albumId, DEFAULT_ALBUM_ID);
    assert.equal(image.provenance, 'generated');

    const loaded = await getImageById(image.id);
    assert.ok(loaded);
    assert.equal(loaded.filePath, `${image.id}.png`);

    const filePath = path.join(homeDir, 'gallery', 'images', loaded.filePath);
    const stat = await fs.stat(filePath);
    assert.ok(stat.size > 0);
  });

  test('creates custom album and assigns images', async () => {
    const album = await createAlbum({ name: 'Landscapes' });
    const image = await saveImageBytes({
      bytes: PNG_BYTES,
      prompt: 'Mountain sunset',
      albumId: album.id,
    });
    assert.equal(image.albumId, album.id);

    const filtered = await listImages({ albumId: album.id });
    assert.ok(filtered.images.some((img) => img.id === image.id));
  });

  test('deletes image file and metadata', async () => {
    const image = await saveImageBytes({
      bytes: PNG_BYTES,
      prompt: 'To delete',
    });
    await deleteImage(image.id);
    assert.equal(await getImageById(image.id), null);
    await assert.rejects(
      () => fs.stat(path.join(homeDir, 'gallery', 'images', image.filePath)),
      /ENOENT/,
    );
  });

  test('enforceCaps keeps image count within maxImages', async () => {
    resetGalleryStoreForTests();
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const image = await saveImageBytes({
        bytes: PNG_BYTES,
        prompt: `Image ${i}`,
      });
      ids.push(image.id);
      await new Promise((r) => setTimeout(r, 5));
    }

    const remaining = await listImages({ limit: 10 });
    assert.ok(remaining.images.length <= 3);
    assert.ok(!remaining.images.some((img) => img.id === ids[0]));
  });
});
