import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClientMessage,
  formatServerMessage,
  MAX_WS_MESSAGE_CHARS,
} from '../../server/terminal/pty-protocol.js';

describe('pty-protocol', () => {
  it('parses input message', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'input', data: 'ls\n' }));
    assert.deepEqual(msg, { type: 'input', data: 'ls\n' });
  });

  it('parses resize message', () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: 'resize', cols: 100, rows: 30 }),
    );
    assert.deepEqual(msg, { type: 'resize', cols: 100, rows: 30 });
  });

  it('rejects oversized payload', () => {
    const huge = 'x'.repeat(MAX_WS_MESSAGE_CHARS + 1);
    assert.equal(parseClientMessage(huge), null);
  });

  it('formats server output', () => {
    const text = formatServerMessage('output', { data: 'hi' });
    assert.deepEqual(JSON.parse(text), { type: 'output', data: 'hi' });
  });
});
