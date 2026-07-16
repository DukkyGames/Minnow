import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { parseGetFileMetadataSize } = await import('../../src/attachments/workspace-text-read.ts');

describe('workspace text read', () => {
  test('parseGetFileMetadataSize reads byte size from metadata', () => {
    const meta = [
      'path: src/index.html',
      'type: file',
      'size: 40791 bytes',
      'modified: 2026-01-01T00:00:00.000Z',
      'created: 2026-01-01T00:00:00.000Z',
      'line_ending: LF',
    ].join('\n');
    assert.equal(parseGetFileMetadataSize(meta), 40_791);
  });

  test('parseGetFileMetadataSize returns null when size line is missing', () => {
    assert.equal(parseGetFileMetadataSize('path: foo\n'), null);
  });
});
