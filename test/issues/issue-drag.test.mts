/**
 * In-flight issue-row drag descriptor and MIME helpers.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  ISSUE_DRAG_MIME,
  beginIssueDrag,
  endIssueDrag,
  getActiveIssueDragIds,
  readIssueDragIds,
  resetIssueDragForTests,
  setIssueDragData,
} from '../../src/issues/issue-drag.ts';

function fakeTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

describe('issue drag ids', () => {
  afterEach(() => {
    resetIssueDragForTests();
  });

  test('setIssueDragData records ids and uses copyMove so row dropEffect move is legal', () => {
    const transfer = fakeTransfer();
    setIssueDragData(transfer, ['MIN-1', 'MIN-2']);
    assert.deepEqual(getActiveIssueDragIds(), ['MIN-1', 'MIN-2']);
    assert.equal(transfer.getData(ISSUE_DRAG_MIME), 'MIN-1,MIN-2');
    assert.equal(transfer.effectAllowed, 'copyMove');
  });

  test('readIssueDragIds falls back to MIME when the in-flight list is empty', () => {
    const transfer = fakeTransfer();
    transfer.setData(ISSUE_DRAG_MIME, 'MIN-3, MIN-4');
    assert.deepEqual(readIssueDragIds(transfer), ['MIN-3', 'MIN-4']);
  });

  test('endIssueDrag keeps ids until after the current turn so drop can read them', async () => {
    beginIssueDrag(['MIN-1']);
    endIssueDrag();
    assert.deepEqual(getActiveIssueDragIds(), ['MIN-1']);
    await Promise.resolve();
    assert.deepEqual(getActiveIssueDragIds(), []);
  });
});
