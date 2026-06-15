/**
 * STT WebSocket protocol parse/format tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseClientMessage,
  parseServerMessage,
  formatServerMessage,
  MAX_STT_WS_MESSAGE_CHARS,
} from '../../server/stt/stt-protocol.js';

describe('stt-protocol', () => {
  test('parseClientMessage accepts start/stop/ping', () => {
    assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'start' })), { type: 'start' });
    assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'stop' })), { type: 'stop' });
    assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'ping' })), { type: 'ping' });
  });

  test('parseClientMessage rejects oversized payload', () => {
    const huge = 'x'.repeat(MAX_STT_WS_MESSAGE_CHARS + 1);
    assert.equal(parseClientMessage(huge), null);
  });

  test('formatServerMessage and parseServerMessage round-trip segment', () => {
    const raw = formatServerMessage('segment', { text: 'hello world' });
    assert.deepEqual(parseServerMessage(raw), { type: 'segment', text: 'hello world' });
  });

  test('parseServerMessage accepts final and error', () => {
    assert.deepEqual(parseServerMessage(formatServerMessage('final', { text: 'done' })), {
      type: 'final',
      text: 'done',
    });
    assert.deepEqual(parseServerMessage(formatServerMessage('error', { message: 'fail' })), {
      type: 'error',
      message: 'fail',
    });
  });
});
