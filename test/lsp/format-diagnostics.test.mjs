import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatDiagnostics } from '../../src/lsp/format-diagnostics.mjs';

describe('formatDiagnostics', () => {
  test('static expected string', () => {
    const out = formatDiagnostics('test/sample.fake', [
      {
        severity: 1,
        message: "';' expected.",
        source: 'fake',
        range: { start: { line: 0, character: 0 } },
      },
    ]);
    const expected = `test/sample.fake
  [Error] L1:1 — ';' expected. (fake)`;
    assert.equal(out, expected);
  });
});
