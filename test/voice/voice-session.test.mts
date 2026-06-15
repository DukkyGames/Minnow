/**
 * Voice session stub — state machine contract for future voice chat.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { VoiceSessionStub } from '../../src/voice/voice-session.ts';
import type { SttStreamClient } from '../../src/voice/stt-stream-client.ts';
import type { TtsStreamClient } from '../../src/voice/tts-stream-client.ts';

/** Minimal STT double — records lifecycle without WebSocket. */
function mockStt(): SttStreamClient {
  let started = false;
  return {
    start: async () => {
      started = true;
    },
    stop: async () => {
      started = false;
      return '';
    },
    close: () => {
      started = false;
    },
    getMediaStream: () => null,
  } as unknown as SttStreamClient;
}

/** Minimal TTS double — records start/cancel without WebSocket. */
function mockTts(): TtsStreamClient {
  return {
    start: async () => {},
    cancel: () => {},
    close: () => {},
  } as unknown as TtsStreamClient;
}

describe('voice-session', () => {
  test('VoiceSessionStub starts in idle', () => {
    const session = new VoiceSessionStub({ stt: mockStt(), tts: mockTts() });
    assert.equal(session.state, 'idle');
  });

  test('startListening moves to listening and stops speaking first', async () => {
    const tts = mockTts();
    let cancelled = false;
    tts.cancel = () => {
      cancelled = true;
    };
    const session = new VoiceSessionStub({ stt: mockStt(), tts });
    session.state = 'speaking';

    await session.startListening();
    assert.equal(cancelled, true);
    assert.equal(session.state, 'listening');
  });

  test('speak stops STT then moves to speaking', async () => {
    let sttStopped = false;
    const stt = mockStt();
    stt.stop = async () => {
      sttStopped = true;
      return 'hello';
    };
    let ttsStarted = false;
    const tts = mockTts();
    tts.start = async (text: string) => {
      ttsStarted = text === 'Hi there';
    };

    const session = new VoiceSessionStub({ stt, tts });
    session.state = 'listening';
    await session.speak('Hi there');

    assert.equal(sttStopped, true);
    assert.equal(ttsStarted, true);
    assert.equal(session.state, 'speaking');
  });

  test('stop tears down clients and returns to idle', async () => {
    let sttClosed = false;
    let ttsCancelled = false;
    const stt = mockStt();
    stt.close = () => {
      sttClosed = true;
    };
    const tts = mockTts();
    tts.cancel = () => {
      ttsCancelled = true;
    };

    const session = new VoiceSessionStub({ stt, tts });
    session.state = 'speaking';
    session.stop();

    assert.equal(sttClosed, true);
    assert.equal(ttsCancelled, true);
    assert.equal(session.state, 'idle');
  });
});
