/**
 * Issue drop targets: accept capture drags and OS file drags.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { WORKSPACE_FILE_MIME } from '../../src/attachments/workspace-ref';
import { dataTransferAcceptsIssueDrop } from '../../src/ui/issue-drop-target';

function fakeTransfer(types: string[], files: File[] = []): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys(), ...types.filter((type) => !store.has(type))];
    },
    get files() {
      const list = {
        length: files.length,
        item: (index: number) => files[index] ?? null,
        [Symbol.iterator]: function* () {
          for (const file of files) yield file;
        },
      };
      return list as unknown as FileList;
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

describe('dataTransferAcceptsIssueDrop', () => {
  test('accepts workspace file-tree drags', () => {
    const transfer = fakeTransfer([WORKSPACE_FILE_MIME]);
    transfer.setData(WORKSPACE_FILE_MIME, 'src/ui/foo.ts');
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });

  test('accepts OS file drags via the Files type', () => {
    const transfer = fakeTransfer(['Files']);
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });

  test('accepts OS file drags when only files[] is populated', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const transfer = fakeTransfer([], [file]);
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });

  test('accepts plain-text selection drags', () => {
    const transfer = fakeTransfer(['text/plain']);
    transfer.setData('text/plain', 'hello');
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });
});
