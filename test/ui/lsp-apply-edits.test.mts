/**
 * Apply LSP text edits to a plain string.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyLspTextEditsToString } from '../../src/ui/lsp-editor/apply-lsp-edits.ts';

describe('applyLspTextEditsToString', () => {
  test('replaces a single range', () => {
    const out = applyLspTextEditsToString('hello world', [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        newText: 'hi',
      },
    ]);
    assert.equal(out, 'hi world');
  });
});
