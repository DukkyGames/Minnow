/**
 * Shell-words parser for llama extra_args.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { splitShellWords } from '../../server/models/shell-words.js';

describe('shell-words', () => {
  test('splits simple tokens', () => {
    assert.deepEqual(splitShellWords('--foo bar'), ['--foo', 'bar']);
  });

  test('respects double quotes', () => {
    assert.deepEqual(splitShellWords('--name "hello world"'), ['--name', 'hello world']);
  });

  test('respects single quotes', () => {
    assert.deepEqual(splitShellWords("--flag 'two words'"), ['--flag', 'two words']);
  });

  test('returns empty array for blank input', () => {
    assert.deepEqual(splitShellWords('   '), []);
  });
});
