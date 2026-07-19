/**
 * Canonical file URI normalization for LSP document keys (Windows drive-letter casing).
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import {
  normalizeAbsolutePath,
  normalizeFileUri,
} from '../../server/lsp/file-uri.js';

describe('LSP file URI normalization', () => {
  test('normalizeAbsolutePath uppercases Windows drive letters', () => {
    if (process.platform !== 'win32') return;
    assert.equal(
      normalizeAbsolutePath('c:\\Users\\dev\\file.ts'),
      'C:\\Users\\dev\\file.ts',
    );
  });

  test('normalizeFileUri matches pathToFileURL and percent-encoded TLS URIs', () => {
    const abs = path.resolve('test/fixtures/sample.fake');
    const fromNode = pathToFileURL(abs).href;
    const canonical = normalizeFileUri(fromNode);
    assert.equal(normalizeFileUri(fromNode), canonical);

    if (process.platform === 'win32') {
      const lowerDriveEncoded = fromNode.replace(
        /^file:\/\/\/([A-Z]):/,
        (_, drive) => `file:///${drive.toLowerCase()}%3A`,
      );
      assert.notEqual(lowerDriveEncoded, fromNode);
      assert.equal(normalizeFileUri(lowerDriveEncoded), canonical);
    }
  });
});
