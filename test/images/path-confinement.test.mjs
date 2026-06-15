/**
 * Gallery path confinement — reject traversal on asset paths.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { resolveGalleryImagePath } from '../../server/images/store.js';
import { galleryImagesDir } from '../../server/images/paths.js';

/** @type {string} */
let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-gallery-path-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await fs.mkdir(galleryImagesDir(), { recursive: true });
});

after(async () => {
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('gallery path confinement', () => {
  test('resolves safe basename under gallery/images', async () => {
    const id = '11111111-1111-1111-1111-111111111111.png';
    const resolved = resolveGalleryImagePath(id);
    assert.equal(resolved, path.join(galleryImagesDir(), id));
  });

  test('rejects directory traversal', () => {
    assert.throws(() => resolveGalleryImagePath('../../../etc/passwd'), /Invalid image path/);
    assert.throws(() => resolveGalleryImagePath('..\\..\\secret.png'), /Invalid image path/);
    assert.throws(() => resolveGalleryImagePath('nested/evil.png'), /Invalid image path/);
    assert.throws(() => resolveGalleryImagePath('not-a-uuid'), /Invalid image path/);
  });

  test('rejects empty path', () => {
    assert.throws(() => resolveGalleryImagePath(''), /Invalid image path/);
  });
});
