import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTerminalWsUrl } from '../../src/api/terminal-pty.ts';

describe('terminal-pty client', () => {
  it('buildTerminalWsUrl includes sessionId', () => {
    globalThis.window = {
      location: { protocol: 'http:', host: 'localhost:5173' },
    };
    const url = buildTerminalWsUrl('abc-123');
    assert.ok(url.includes('sessionId=abc-123'));
    assert.ok(url.startsWith('ws://'));
  });
});
