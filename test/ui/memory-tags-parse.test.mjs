import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseMemoryTagsInput } from '../../src/memory/parse-tags.ts';

describe('parseMemoryTagsInput', () => {
  test('splits comma-separated tags and trims', () => {
    assert.deepEqual(parseMemoryTagsInput('a, b ,,c'), ['a', 'b', 'c']);
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(parseMemoryTagsInput(''), []);
    assert.deepEqual(parseMemoryTagsInput('  ,  , '), []);
  });
});
