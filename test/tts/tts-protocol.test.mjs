/**
 * TTS WebSocket protocol parse/format tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseClientMessage,
  parseServerMessage,
  formatServerMessage,
  MAX_TTS_WS_MESSAGE_CHARS,
} from '../../server/tts/tts-protocol.js';

describe('tts-protocol', () => {
  test('parseClientMessage accepts start with text and optional overrides', () => {
    assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'start', text: 'hello' })), {
      type: 'start',
      text: 'hello',
    });
    assert.deepEqual(
      parseClientMessage(
        JSON.stringify({ type: 'start', text: 'hi', voice: 'Ryan', speed: 1.2 }),
      ),
      { type: 'start', text: 'hi', voice: 'Ryan', speed: 1.2 },
    );
  });

  test('parseClientMessage rejects start without text', () => {
    assert.equal(parseClientMessage(JSON.stringify({ type: 'start' })), null);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'start', text: '   ' })), null);
  });

  test('parseClientMessage accepts cancel and ping', () => {
    assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'cancel' })), { type: 'cancel' });
    assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'ping' })), { type: 'ping' });
  });

  test('parseClientMessage rejects oversized payload', () => {
    const huge = 'x'.repeat(MAX_TTS_WS_MESSAGE_CHARS + 1);
    assert.equal(parseClientMessage(huge), null);
  });

  test('formatServerMessage and parseServerMessage round-trip ready', () => {
    const raw = formatServerMessage('ready', { sampleRate: 24000 });
    assert.deepEqual(parseServerMessage(raw), { type: 'ready', sampleRate: 24000 });
  });

  test('parseServerMessage accepts final and error', () => {
    assert.deepEqual(parseServerMessage(formatServerMessage('final', { durationMs: 500 })), {
      type: 'final',
      durationMs: 500,
    });
    assert.deepEqual(parseServerMessage(formatServerMessage('error', { message: 'fail' })), {
      type: 'error',
      message: 'fail',
    });
  });
});
