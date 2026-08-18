/**
 * Capture drag layer: active-drag descriptor during dragover.
 */

import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';

import { WORKSPACE_FILE_MIME } from '../../src/attachments/workspace-ref';
import {
  beginCaptureDrag,
  dataTransferLooksCapturable,
  resetCaptureDragForTests,
} from '../../src/ui/capture-drag';

describe('dataTransferLooksCapturable', () => {
  afterEach(() => {
    resetCaptureDragForTests();
  });

  test('returns true while a capture drag is active even without MIME types', () => {
    beginCaptureDrag(null, {
      items: [{ kind: 'file', label: 'foo.ts', codeRef: { path: 'src/foo.ts' } }],
    });
    assert.equal(dataTransferLooksCapturable(null), true);
  });

  test('returns true for workspace file MIME on the transfer', () => {
    const transfer = {
      types: [WORKSPACE_FILE_MIME],
    } as DataTransfer;
    assert.equal(dataTransferLooksCapturable(transfer), true);
  });
});
