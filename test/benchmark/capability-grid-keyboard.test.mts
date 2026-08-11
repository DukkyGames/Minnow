import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { adjacentCapabilityGridCell } from '../../src/ui/capability-matrix/grid-keyboard.ts';

describe('capability grid keyboard nav', () => {
  test('adjacentCapabilityGridCell maps arrow keys', () => {
    assert.deepEqual(adjacentCapabilityGridCell(0, 0, 'ArrowRight'), { row: 0, col: 1 });
    assert.deepEqual(adjacentCapabilityGridCell(0, 1, 'ArrowLeft'), { row: 0, col: 0 });
    assert.deepEqual(adjacentCapabilityGridCell(0, 0, 'ArrowDown'), { row: 1, col: 0 });
    assert.deepEqual(adjacentCapabilityGridCell(1, 0, 'ArrowUp'), { row: 0, col: 0 });
    assert.equal(adjacentCapabilityGridCell(0, 0, 'ArrowLeft'), null);
    assert.equal(adjacentCapabilityGridCell(0, 0, 'Enter'), null);
  });
});
