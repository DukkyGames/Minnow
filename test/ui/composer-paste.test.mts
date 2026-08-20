/**
 * Clipboard paste → composer attachments (screenshots, copied image files).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  imageFilesFromClipboard,
  pasteIsImageOnly,
} from '../../src/ui/composer-paste.ts';

/** Minimal DataTransfer stand-in — happy-dom does not synthesize paste payloads. */
function clipboard(options: {
  files?: File[];
  text?: string;
  itemsOnly?: boolean;
}): DataTransfer {
  const files = options.files ?? [];
  const items = files.map((file) => ({
    kind: 'file' as const,
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    items,
    files: options.itemsOnly ? [] : files,
    getData: (type: string) => (type === 'text/plain' ? (options.text ?? '') : ''),
  } as unknown as DataTransfer;
}

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

describe('pasteIsImageOnly', () => {
  it('is true for a bare screenshot', () => {
    assert.equal(pasteIsImageOnly(clipboard({ files: [png('image.png')] })), true);
  });

  it('is false when the clipboard also carries text', () => {
    // Copying a rich cell or a formatted snippet ships an image preview alongside
    // the text; the user means the text, so the paste must fall through.
    assert.equal(
      pasteIsImageOnly(clipboard({ files: [png('image.png')], text: 'SELECT 1' })),
      false,
    );
  });

  it('is false for no clipboard at all', () => {
    assert.equal(pasteIsImageOnly(null), false);
  });
});

describe('imageFilesFromClipboard', () => {
  it('renames the generic screenshot blob to a unique, dated name', () => {
    const out = imageFilesFromClipboard(clipboard({ files: [png('image.png')] }));
    assert.equal(out.length, 1);
    assert.match(out[0].name, /^pasted-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/);
    assert.equal(out[0].type, 'image/png');
  });

  it('keeps a real filename from a copied image file', () => {
    const out = imageFilesFromClipboard(clipboard({ files: [png('diagram.png')] }));
    assert.equal(out[0].name, 'diagram.png');
  });

  it('reads items when the payload exposes no files list', () => {
    const out = imageFilesFromClipboard(
      clipboard({ files: [png('image.png')], itemsOnly: true }),
    );
    assert.equal(out.length, 1);
  });

  it('does not double-count a file present in both items and files', () => {
    assert.equal(imageFilesFromClipboard(clipboard({ files: [png('shot.png')] })).length, 1);
  });

  it('ignores non-image clipboard files', () => {
    const doc = new File(['x'], 'notes.txt', { type: 'text/plain' });
    assert.deepEqual(imageFilesFromClipboard(clipboard({ files: [doc] })), []);
  });

  it('is empty for no clipboard', () => {
    assert.deepEqual(imageFilesFromClipboard(null), []);
  });
});
