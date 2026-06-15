/**
 * TTS stream session helper tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  TtsStreamSession,
  checkTtsStreamEligibility,
} from '../../server/tts/stream-session.js';

describe('tts stream-session', () => {
  test('checkTtsStreamEligibility requires local backend and streaming enabled', () => {
    assert.deepEqual(
      checkTtsStreamEligibility({ tts: { enabled: true, backend: 'provider' } }),
      { ok: false, error: 'Streaming TTS requires local backend' },
    );
    assert.deepEqual(
      checkTtsStreamEligibility({
        tts: { enabled: true, backend: 'local', streaming: false },
      }),
      { ok: false, error: 'Streaming TTS is disabled in settings' },
    );
    assert.deepEqual(
      checkTtsStreamEligibility({
        tts: { enabled: true, backend: 'local', streaming: true },
      }),
      { ok: true },
    );
  });

  test('relayWorkerEvent sends ready then binary PCM on first chunk', () => {
    const sent = [];
    const ws = {
      readyState: 1,
      OPEN: 1,
      send(data, opts) {
        sent.push({ data, binary: opts?.binary === true });
      },
      close() {},
    };
    const session = new TtsStreamSession(ws);
    const pcm = Buffer.from([0x01, 0x00, 0x02, 0x00]);
    session.relayWorkerEvent({ type: 'chunk', pcm, sampleRate: 22050, frameIndex: 0 });

    assert.equal(sent.length, 2);
    assert.equal(sent[0].binary, false);
    assert.match(String(sent[0].data), /"type":"ready"/);
    assert.match(String(sent[0].data), /"sampleRate":22050/);
    assert.equal(sent[1].binary, true);
    assert.deepEqual(sent[1].data, pcm);
  });

  test('relayWorkerEvent forwards subsequent chunks as binary only', () => {
    const sent = [];
    const ws = {
      readyState: 1,
      OPEN: 1,
      send(data, opts) {
        sent.push({ data, binary: opts?.binary === true });
      },
      close() {},
    };
    const session = new TtsStreamSession(ws);
    session.readySent = true;
    const pcm = Buffer.from([0x03, 0x00]);
    session.relayWorkerEvent({ type: 'chunk', pcm, sampleRate: 24000, frameIndex: 1 });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].binary, true);
    assert.deepEqual(sent[0].data, pcm);
  });

  test('relayWorkerEvent sends error JSON on worker error', () => {
    const sent = [];
    const ws = {
      readyState: 1,
      OPEN: 1,
      send(data) {
        sent.push(String(data));
      },
      close() {},
    };
    const session = new TtsStreamSession(ws);
    session.relayWorkerEvent({ type: 'error', message: 'synthesis failed' });

    assert.equal(sent.length, 1);
    assert.match(sent[0], /"type":"error"/);
    assert.match(sent[0], /synthesis failed/);
  });

  test('relayWorkerEvent stores final duration for handleStart', () => {
    const ws = {
      readyState: 1,
      OPEN: 1,
      send() {},
      close() {},
    };
    const session = new TtsStreamSession(ws);
    session.relayWorkerEvent({ type: 'final', durationMs: 750 });
    assert.equal(session.durationMs, 750);
  });
});
