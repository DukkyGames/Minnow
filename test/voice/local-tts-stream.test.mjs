/**
 * Local TTS streaming bridge tests — SSE parser and abort handling.
 */

import assert from 'node:assert/strict';
import { describe, test, after } from 'node:test';
import {
  createLocalTtsStream,
  parseTtsSseBlock,
  resetLocalTtsForTests,
} from '../../server/voice/local-tts.js';
import {
  resetVoiceFetchOverrideForTests,
  resetVoiceRuntimeForTests,
  setVoiceFetchOverrideForTests,
  setWorkerStateForTests,
} from '../../server/voice/runtime-manager.js';

after(() => {
  resetVoiceRuntimeForTests();
  resetVoiceFetchOverrideForTests();
  resetLocalTtsForTests();
});

/** Build a minimal SSE block for tests. */
function sseBlock(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

describe('local TTS stream SSE parser', () => {
  test('parseTtsSseBlock decodes chunk pcmBase64', () => {
    const pcm = Buffer.from([0x01, 0x00, 0x02, 0x00]);
    const events = [];
    parseTtsSseBlock(
      sseBlock('chunk', {
        pcmBase64: pcm.toString('base64'),
        sampleRate: 24000,
        frameIndex: 2,
      }),
      (event) => events.push(event),
      { onFinal: () => {} },
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'chunk');
    assert.deepEqual(events[0].pcm, pcm);
    assert.equal(events[0].sampleRate, 24000);
    assert.equal(events[0].frameIndex, 2);
  });

  test('parseTtsSseBlock handles final and error events', () => {
    const finalEvents = [];
    let finalMs;
    parseTtsSseBlock(
      sseBlock('final', { durationMs: 900 }),
      (event) => {
        if (event.type === 'final') finalEvents.push(event);
      },
      { onFinal: (ms) => { finalMs = ms; } },
    );
    const errors = [];
    parseTtsSseBlock(
      sseBlock('error', { message: 'boom' }),
      (event) => {
        if (event.type === 'error') errors.push(event);
      },
      { onFinal: () => {} },
    );

    assert.equal(finalMs, 900);
    assert.equal(finalEvents[0].durationMs, 900);
    assert.deepEqual(errors[0], { type: 'error', message: 'boom' });
  });
});

describe('createLocalTtsStream', () => {
  test('streams NDJSON ops and relays SSE chunks until final', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9877,
      healthy: true,
      phase: 'running',
    });

    const ndjsonBodies = [];
    setVoiceFetchOverrideForTests(async (url, init) => {
      if (String(url).endsWith('/models/load')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(url).endsWith('/tts/stream')) {
        const body = init?.body;
        if (body && typeof body.on === 'function') {
          body.on('data', (chunk) => ndjsonBodies.push(chunk.toString('utf8')));
        }
        const pcm = Buffer.from([0x0a, 0x00]);
        const sse =
          sseBlock('chunk', {
            pcmBase64: pcm.toString('base64'),
            sampleRate: 24000,
            frameIndex: 0,
          }) +
          sseBlock('final', { durationMs: 120 });
        return new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const chunks = [];
    const stream = createLocalTtsStream({
      localConfig: {
        modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        mode: 'custom_voice',
        customVoice: { speaker: 'Ryan', language: 'English' },
      },
      onEvent: (event) => chunks.push(event),
    });

    await stream.open();
    stream.writeText('Hello');
    const result = await stream.finish();

    assert.equal(result.durationMs, 120);
    assert.ok(ndjsonBodies.join('').includes('"op":"start"'));
    assert.ok(ndjsonBodies.join('').includes('"op":"finish"'));
    assert.equal(chunks.filter((e) => e.type === 'chunk').length, 1);
    assert.equal(chunks.filter((e) => e.type === 'final').length, 1);
  });

  test('abort cancels the in-flight worker request', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9877,
      healthy: true,
      phase: 'running',
    });

    let aborted = false;
    setVoiceFetchOverrideForTests(async (url, init) => {
      if (String(url).endsWith('/models/load')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(url).endsWith('/tts/stream')) {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise(() => {});
      }
      throw new Error(`unexpected ${url}`);
    });

    const stream = createLocalTtsStream({
      localConfig: {
        modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        mode: 'custom_voice',
      },
    });

    await stream.open();
    stream.writeText('cancel me');
    await stream.abort();
    assert.equal(aborted, true);
  });
});
