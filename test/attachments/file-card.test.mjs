import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  estimateTextByteSize,
  formatAttachmentBytes,
  formatFileCardSizeLabel,
  getFileCardMeta,
  inferFileKindFromName,
} from '../../src/attachments/file-card.ts';

describe('formatAttachmentBytes', () => {
  it('formats bytes, kilobytes, and megabytes', () => {
    assert.equal(formatAttachmentBytes(0), '0 B');
    assert.equal(formatAttachmentBytes(512), '512 B');
    assert.equal(formatAttachmentBytes(2048), '2.0 KB');
    assert.equal(formatAttachmentBytes(12 * 1024), '12 KB');
    assert.equal(formatAttachmentBytes(9 * 1024), '9.0 KB');
    assert.equal(formatAttachmentBytes(2 * 1024 * 1024), '2.0 MB');
  });
});

describe('getFileCardMeta', () => {
  it('classifies code, pdf, office, and generic files', () => {
    assert.deepEqual(getFileCardMeta('utils.ts', 'text'), {
      badge: 'TS',
      variant: 'code',
    });
    assert.deepEqual(getFileCardMeta('report.pdf', 'pdf'), {
      badge: 'PDF',
      variant: 'pdf',
    });
    assert.deepEqual(getFileCardMeta('budget.xlsx', 'text'), {
      badge: 'XLSX',
      variant: 'doc',
    });
    assert.deepEqual(getFileCardMeta('archive.bin', 'text'), {
      badge: 'BIN',
      variant: 'code',
    });
    assert.deepEqual(getFileCardMeta('README', 'text'), {
      badge: 'FILE',
      variant: 'file',
    });
  });
});

describe('formatFileCardSizeLabel', () => {
  it('shows Workspace for unresolved workspace refs', () => {
    assert.equal(formatFileCardSizeLabel(0, { workspace: true }), 'Workspace');
    assert.equal(formatFileCardSizeLabel(1024, { workspace: true }), '1.0 KB');
  });
});

describe('inferFileKindFromName', () => {
  it('detects pdf extension', () => {
    assert.equal(inferFileKindFromName('notes.pdf'), 'pdf');
    assert.equal(inferFileKindFromName('notes.ts'), 'text');
  });
});

describe('estimateTextByteSize', () => {
  it('counts utf-8 bytes', () => {
    assert.equal(estimateTextByteSize('hello'), 5);
    assert.equal(estimateTextByteSize('café'), 5);
  });
});
