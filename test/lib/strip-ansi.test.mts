/**
 * stripAnsi — plain-text console output (agent + dev-server panes).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { stripAnsi } from '../../src/lib/strip-ansi.ts';

describe('stripAnsi', () => {
  test('removes Vite-style SGR color codes', () => {
    const raw =
      '\x1b[2m12:22:31 AM\x1b[22m \x1b[31m\x1b[1m[vite]\x1b[22m\x1b[39m \x1b[31mhttp proxy error: /api/stock\x1b[39m';
    assert.equal(
      stripAnsi(raw),
      '12:22:31 AM [vite] http proxy error: /api/stock',
    );
  });

  test('leaves plain text unchanged', () => {
    assert.equal(stripAnsi('hello\nworld'), 'hello\nworld');
  });

  test('returns empty string for escape-only chunks', () => {
    assert.equal(stripAnsi('\x1b[31m\x1b[39m'), '');
  });
});
