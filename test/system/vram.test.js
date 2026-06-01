import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseNvidiaSmiVram } from '../../server/system/vram.js';

describe('parseNvidiaSmiVram', () => {
  test('parses first GPU CSV row', () => {
    const result = parseNvidiaSmiVram('18234, 24576\n');
    assert.deepEqual(result, { available: true, usedMb: 18234, totalMb: 24576 });
  });

  test('returns unavailable for empty output', () => {
    assert.deepEqual(parseNvidiaSmiVram(''), { available: false });
    assert.deepEqual(parseNvidiaSmiVram('not,a,number'), { available: false });
  });
});
