/**
 * Tolerant file-edit matching (EOL + trailing whitespace).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coerceContentToFileEol,
  detectDominantEol,
  flexibleReplaceAll,
  resolveInsertLineFromAnchor,
} from '../../server/tools/flexible-match.js';

describe('detectDominantEol', () => {
  it('prefers CRLF when CRLF count is higher', () => {
    assert.equal(detectDominantEol('a\r\nb\r\nc\n'), '\r\n');
  });

  it('prefers LF when LF count is higher', () => {
    assert.equal(detectDominantEol('a\nb\nc\n'), '\n');
  });
});

describe('flexibleReplaceAll', () => {
  it('exact match still works', () => {
    const { output, count, mode } = flexibleReplaceAll('foo bar foo', 'foo', 'baz');
    assert.equal(count, 2);
    assert.equal(mode, 'exact');
    assert.equal(output, 'baz bar baz');
  });

  it('matches CRLF file with LF search', () => {
    const file = 'line1\r\nline2\r\nline3\r\n';
    const search = 'line2\nline3';
    const { output, count, mode } = flexibleReplaceAll(file, search, 'replaced');
    assert.equal(count, 1);
    assert.equal(mode, 'eol');
    assert.equal(output, 'line1\r\nreplaced\r\n');
    assert.ok(!output.includes('\nline'));
  });

  it('matches trailing-whitespace drift between lines', () => {
    const file = 'alpha  \r\nbeta\t\r\ngamma';
    const search = 'alpha\nbeta';
    const { output, count, mode } = flexibleReplaceAll(file, search, 'ok');
    assert.equal(count, 1);
    assert.equal(mode, 'whitespace');
    assert.equal(output, 'ok\r\ngamma');
  });

  it('preserves file EOL on replacement', () => {
    const file = 'a\r\nb\r\nc';
    const { output } = flexibleReplaceAll(file, 'b', 'B');
    assert.equal(output, 'a\r\nB\r\nc');
  });

  it('returns near-miss hint when no match', () => {
    const file = 'first line\nsecond line\nthird line';
    const search = 'first line\nwrong line';
    const { count, hint } = flexibleReplaceAll(file, search, 'x');
    assert.equal(count, 0);
    assert.match(hint, /first search line was found at line 1/);
    assert.match(hint, /surrounding lines differ/);
  });
});
describe('coerceContentToFileEol', () => {
  it('leaves new-file content unchanged', () => {
    const { content, converted, eol } = coerceContentToFileEol('a\nb\n', '');
    assert.equal(content, 'a\nb\n');
    assert.equal(converted, false);
    assert.equal(eol, null);
  });

  it('converts LF write content to match existing CRLF file', () => {
    const existing = 'old\r\nline\r\n';
    const { content, converted, eol } = coerceContentToFileEol('new\nline\n', existing);
    assert.equal(content, 'new\r\nline\r\n');
    assert.equal(converted, true);
    assert.equal(eol, '\r\n');
  });

  it('converts CRLF append chunk to match existing LF file', () => {
    const existing = 'alpha\n';
    const { content, converted, eol } = coerceContentToFileEol('beta\r\n', existing);
    assert.equal(content, 'beta\n');
    assert.equal(converted, true);
    assert.equal(eol, '\n');
  });
});

describe('resolveInsertLineFromAnchor', () => {
  const file = 'const obj = {\r\n  a: 1,\r\n});\r\n';

  it('before_text resolves to the anchor line', () => {
    const result = resolveInsertLineFromAnchor(file, '});', 'before');
    assert.equal('lineIndex' in result && result.lineIndex, 2);
  });

  it('after_text resolves to the line after the anchor', () => {
    const result = resolveInsertLineFromAnchor(file, 'a: 1,', 'after');
    assert.equal('lineIndex' in result && result.lineIndex, 2);
  });

  it('refuses when anchor is not found', () => {
    const result = resolveInsertLineFromAnchor(file, 'missing', 'before');
    assert.equal('error' in result && result.error, 'anchor text not found in file');
  });

  it('refuses when anchor is ambiguous', () => {
    const ambiguous = 'x\ny\nx\n';
    const result = resolveInsertLineFromAnchor(ambiguous, 'x', 'before');
    assert.match('error' in result && result.error, /appears 2 times/);
  });
});

describe('insert trailing newline behavior', () => {
  it('stripping trailing newline avoids an extra blank line when splitting', () => {
    const content = 'field,\n';
    const stripped = content.replace(/\r?\n$/, '');
    assert.deepEqual(stripped.split(/\r?\n/), ['field,']);
  });
});
