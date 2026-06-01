/**
 * Workspace image path helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isImageFilePath,
  mimeTypeForImagePath,
} from '../../src/attachments/image-path.ts';

describe('isImageFilePath', () => {
  it('matches common image extensions', () => {
    assert.equal(isImageFilePath('assets/logo.png'), true);
    assert.equal(isImageFilePath('photos/vacation.JPEG'), true);
    assert.equal(isImageFilePath('icon.svg'), true);
    assert.equal(isImageFilePath('favicon.ico'), true);
  });

  it('rejects non-image paths', () => {
    assert.equal(isImageFilePath('src/app.ts'), false);
    assert.equal(isImageFilePath('README.md'), false);
    assert.equal(isImageFilePath('archive.zip'), false);
    assert.equal(isImageFilePath('noextension'), false);
  });
});

describe('mimeTypeForImagePath', () => {
  it('maps extensions to image MIME types', () => {
    assert.equal(mimeTypeForImagePath('a.png'), 'image/png');
    assert.equal(mimeTypeForImagePath('b.jpg'), 'image/jpeg');
    assert.equal(mimeTypeForImagePath('c.webp'), 'image/webp');
    assert.equal(mimeTypeForImagePath('d.svg'), 'image/svg+xml');
  });

  it('falls back for unknown image extension', () => {
    assert.equal(mimeTypeForImagePath('x.unknown'), 'application/octet-stream');
  });
});
