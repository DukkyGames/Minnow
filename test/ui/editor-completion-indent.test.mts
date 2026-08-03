/**
 * reindentCompletionText — cursor-relative indentation for inline completions.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { reindentCompletionText } from '../../src/ui/editor-ai-completion-prompt.ts';

describe('reindentCompletionText', () => {
  test('preserves leading newlines and anchors continuation lines', () => {
    const prefix = 'function fn() {\n  ';
    assert.equal(
      reindentCompletionText('\nreturn 1;', prefix, '  '),
      '\n  return 1;',
    );
  });

  test('strips leading whitespace on the first completion line', () => {
    const prefix = '  const x = ';
    assert.equal(reindentCompletionText('    42;', prefix, '  '), '42;');
  });

  test('re-anchors multi-line blocks to cursor indent', () => {
    const prefix = 'function fn() {\n    ';
    const raw = 'return 1;\n        return 2;';
    assert.equal(
      reindentCompletionText(raw, prefix, '    '),
      'return 1;\n    return 2;',
    );
  });

  test('blank continuation lines stay blank', () => {
    const prefix = '  ';
    const raw = 'a\n\nb';
    assert.equal(reindentCompletionText(raw, prefix, '  '), 'a\n\n  b');
  });

  test('normalizes tabs in model indent to indent units', () => {
    const prefix = '  ';
    assert.equal(reindentCompletionText('\t\tcode', prefix, '  '), 'code');
  });
});
