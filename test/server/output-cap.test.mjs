/**
 * Shared output-cap helpers (MIN-345).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_OUTPUT_CHARS,
  appendWithByteCap,
  capLineLength,
  capReadFileOutput,
  capTextOutput,
} from '../../server/tools/output-cap.js';

describe('output-cap', () => {
  it('capLineLength adds ellipsis for long lines', () => {
    const line = 'x'.repeat(500);
    const capped = capLineLength(line, 100);
    assert.equal(capped.length, 100);
    assert.match(capped, /\.\.\.$/);
  });

  it('capTextOutput truncates with metadata footer', () => {
    const text = 'a'.repeat(DEFAULT_MAX_OUTPUT_CHARS + 100);
    const { text: capped, truncated } = capTextOutput(text);
    assert.equal(truncated, true);
    assert.ok(capped.length < text.length);
    assert.match(capped, /\[truncated — \d+ of \d+ chars;/);
  });

  it('appendWithByteCap stops at byte budget', () => {
    const chunk = 'ü'.repeat(10);
    const first = appendWithByteCap('', chunk, 4);
    assert.equal(first.truncated, true);
    assert.ok(Buffer.byteLength(first.text, 'utf8') <= 4);
  });

  it('capReadFileOutput keeps complete lines and suggests read_file_range', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i + 1}`);
    const content = lines.join('\n');
    const { text, truncated } = capReadFileOutput(content, 'big.txt', 80);
    assert.equal(truncated, true);
    assert.match(text, /read_file_range with path="big.txt"/);
    assert.doesNotMatch(text, /line-200/);
  });
});
