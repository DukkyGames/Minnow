/**
 * Bracket alignment for inline AI completions.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  alignCompletionBrackets,
  bracketStackFromPrefix,
} from '../../src/ui/editor-completion-brackets.ts';

describe('editor completion brackets', () => {
  test('bracketStackFromPrefix ignores closers inside strings', () => {
    const stack = bracketStackFromPrefix('const s = "(not a bracket"; (', 'typescript');
    assert.deepEqual(stack, ['(']);
  });

  test('trimTrailing closers already present in suffix', () => {
    const result = alignCompletionBrackets('1)', '((', ')', 'typescript');
    assert.equal(result.rejected, false);
    assert.equal(result.text, '1');
  });

  test('appends missing closers when rest of line is blank', () => {
    const result = alignCompletionBrackets('foo', 'if (x', '', 'typescript');
    assert.equal(result.rejected, false);
    assert.equal(result.text, 'foo)');
  });

  test('rejects heavily unbalanced completions', () => {
    const result = alignCompletionBrackets('(((', 'x', '', 'typescript');
    assert.equal(result.rejected, true);
    assert.equal(result.reason, 'unbalanced');
  });
});
