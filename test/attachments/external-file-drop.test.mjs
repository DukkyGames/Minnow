import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyFileDrag,
  filesFromDataTransfer,
  hasExternalFileDrag,
  hasWorkspaceFileDrag,
  isLikelyDirectoryDrop,
} from '../../src/attachments/external-file-drop.ts';
import { WORKSPACE_FILE_MIME } from '../../src/attachments/workspace-ref.ts';

/** Minimal DataTransfer stub for unit tests. */
function makeTransfer(types, files = [], data = {}) {
  return {
    types,
    files,
    getData: (type) => data[type] ?? '',
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}

describe('external-file-drop', () => {
  test('classifyFileDrag prefers external when Files type is present', () => {
    const transfer = makeTransfer(['Files', 'text/plain'], [new File(['x'], 'note.txt')], {
      'text/plain': 'C:\\Users\\note.txt',
    });
    assert.equal(classifyFileDrag(transfer), 'external');
  });

  test('classifyFileDrag uses workspace MIME for internal tree drags', () => {
    const transfer = makeTransfer(
      [WORKSPACE_FILE_MIME, 'text/plain'],
      [],
      { [WORKSPACE_FILE_MIME]: 'src/main.ts', 'text/plain': 'src/main.ts' },
    );
    assert.equal(classifyFileDrag(transfer), 'workspace');
  });

  test('hasWorkspaceFileDrag accepts plain single-line paths', () => {
    const transfer = makeTransfer(['text/plain'], [], { 'text/plain': 'docs/readme.md' });
    assert.equal(hasWorkspaceFileDrag(transfer), true);
  });

  test('hasExternalFileDrag detects Files type', () => {
    assert.equal(hasExternalFileDrag(makeTransfer(['Files'])), true);
    assert.equal(hasExternalFileDrag(makeTransfer(['text/plain'])), false);
  });

  test('filesFromDataTransfer collects File objects', () => {
    const a = new File(['a'], 'a.txt');
    const b = new File(['b'], 'b.txt');
    const transfer = makeTransfer(['Files'], [a, b]);
    assert.deepEqual(filesFromDataTransfer(transfer), [a, b]);
  });

  test('isLikelyDirectoryDrop flags extensionless names', () => {
    assert.equal(isLikelyDirectoryDrop(new File([], 'my-folder')), true);
    assert.equal(isLikelyDirectoryDrop(new File(['x'], 'readme.md')), false);
  });
});
