import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  parseReadFileRangeBody,
  formatViewerPathLabel,
  hasLargeFileExcerptFooter,
  isMarkdownFilePath,
  shouldUseMarkdownPreview,
  LARGE_FILE_BYTES,
  saveCurrentFile,
  bindFileViewerControls,
  bindFileViewerContextMenu,
} = await import('../../src/ui/file-viewer.ts');

describe('file viewer save helpers', () => {
  test('parseReadFileRangeBody strips line prefixes', () => {
    const raw = '1: alpha\n2: beta';
    assert.equal(parseReadFileRangeBody(raw), 'alpha\nbeta');
  });

  test('parseReadFileRangeBody normalizes CRLF before stripping prefixes', () => {
    const raw = '1: alpha\r\n2: beta\r\n';
    assert.equal(parseReadFileRangeBody(raw), 'alpha\nbeta\n');
  });

  test('formatViewerPathLabel adds dirty marker', () => {
    assert.equal(formatViewerPathLabel('src/app.ts', false), 'src/app.ts');
    assert.equal(formatViewerPathLabel('src/app.ts', true), 'src/app.ts ●');
  });

  test('hasLargeFileExcerptFooter detects excerpt notice', () => {
    const footer = `\n\n/* Showing lines 1–2000 only (600000 bytes total). */`;
    assert.equal(hasLargeFileExcerptFooter(`line\n${footer}`), true);
    assert.equal(hasLargeFileExcerptFooter('plain file'), false);
  });

  test('LARGE_FILE_BYTES is 512000', () => {
    assert.equal(LARGE_FILE_BYTES, 512_000);
  });

  test('isMarkdownFilePath matches md and markdown extensions', () => {
    assert.equal(isMarkdownFilePath('documentation/plans/foo.md'), true);
    assert.equal(isMarkdownFilePath('README.markdown'), true);
    assert.equal(isMarkdownFilePath('src/app.ts'), false);
  });

  test('shouldUseMarkdownPreview defaults markdown to preview unless asCode', () => {
    assert.equal(shouldUseMarkdownPreview('README.md'), true);
    assert.equal(shouldUseMarkdownPreview('README.md', true), false);
    assert.equal(shouldUseMarkdownPreview('src/app.ts'), false);
    assert.equal(shouldUseMarkdownPreview('src/app.ts', true), false);
  });

  test('saveCurrentFile returns false when nothing open', async () => {
    assert.equal(await saveCurrentFile(), false);
  });

  test('bindFileViewerControls is exported', () => {
    assert.equal(typeof bindFileViewerControls, 'function');
  });

  test('bindFileViewerContextMenu is exported', () => {
    assert.equal(typeof bindFileViewerContextMenu, 'function');
  });
});
