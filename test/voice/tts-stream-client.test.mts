/**
 * TTS stream client protocol parsing tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseTtsServerMessage,
  buildTtsWsUrl,
} from '../../src/voice/tts-stream-client.ts';

describe('tts-stream-client', () => {
  test('parseTtsServerMessage accepts ready, final, and error', () => {
    assert.deepEqual(
      parseTtsServerMessage(JSON.stringify({ type: 'ready', sampleRate: 24000 })),
      { type: 'ready', sampleRate: 24000 },
    );
    assert.deepEqual(parseTtsServerMessage(JSON.stringify({ type: 'final' })), {
      type: 'final',
    });
    assert.deepEqual(
      parseTtsServerMessage(JSON.stringify({ type: 'final', durationMs: 1200 })),
      { type: 'final', durationMs: 1200 },
    );
    assert.deepEqual(
      parseTtsServerMessage(JSON.stringify({ type: 'error', message: 'fail' })),
      { type: 'error', message: 'fail' },
    );
  });

  test('parseTtsServerMessage rejects unknown or malformed payloads', () => {
    assert.equal(parseTtsServerMessage('not json'), null);
    assert.equal(parseTtsServerMessage(JSON.stringify({ type: 'ready' })), null);
    assert.equal(parseTtsServerMessage(JSON.stringify({ type: 'segment', text: 'x' })), null);
  });

  test('buildTtsWsUrl targets /api/tts/ws on current host', () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { protocol: 'http:', host: 'localhost:5173' },
      },
    });
    try {
      assert.equal(buildTtsWsUrl(), 'ws://localhost:5173/api/tts/ws');
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
