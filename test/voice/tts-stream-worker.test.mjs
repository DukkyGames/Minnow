/**
 * TTS streaming worker protocol — NDJSON request ops and SSE response events.
 * Mirrors `server/voice/python/worker.py` TtsStreamSession contract for Phase 2.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defaultVoiceConfig, normalizeVoiceConfig } from '../../server/config/validators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PY = join(__dirname, '../../server/voice/python/worker.py');
const PROVISION_JS = join(__dirname, '../../server/voice/provision.js');

/** Build one NDJSON line for the worker `/tts/stream` body. */
function ndjsonLine(op, text = '') {
  const row = { op };
  if (text) row.text = text;
  return `${JSON.stringify(row)}\n`;
}

/** Parse SSE blocks (`event:` + `data:`) from worker text/event-stream responses. */
function parseTtsStreamSseBlocks(raw) {
  const events = [];
  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue;
    let eventName = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    events.push({ event: eventName, payload: JSON.parse(data) });
  }
  return events;
}

/** Concatenate NDJSON ops the way a streaming TTS client would send them. */
function buildNdjsonBody(parts) {
  return parts.map(({ op, text }) => ndjsonLine(op, text)).join('');
}

describe('TTS stream worker protocol', () => {
  test('NDJSON ops use start, append, and finish', () => {
    const body = buildNdjsonBody([
      { op: 'start', text: 'Hello ' },
      { op: 'append', text: 'world' },
      { op: 'finish' },
    ]);
    const lines = body.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines, [
      { op: 'start', text: 'Hello ' },
      { op: 'append', text: 'world' },
      { op: 'finish' },
    ]);
  });

  test('SSE chunk event carries pcmBase64, sampleRate, frameIndex', () => {
    const sample = [
      'event: chunk',
      'data: {"pcmBase64":"AAAA","sampleRate":24000,"frameIndex":0}',
      '',
    ].join('\n');
    const [evt] = parseTtsStreamSseBlocks(sample);
    assert.equal(evt.event, 'chunk');
    assert.equal(evt.payload.pcmBase64, 'AAAA');
    assert.equal(evt.payload.sampleRate, 24000);
    assert.equal(evt.payload.frameIndex, 0);
  });

  test('SSE final event carries durationMs', () => {
    const sample = ['event: final', 'data: {"durationMs":1234}', ''].join('\n');
    const [evt] = parseTtsStreamSseBlocks(sample);
    assert.equal(evt.event, 'final');
    assert.equal(evt.payload.durationMs, 1234);
  });

  test('SSE error event carries message', () => {
    const sample = ['event: error', 'data: {"message":"No text to synthesize"}', ''].join('\n');
    const [evt] = parseTtsStreamSseBlocks(sample);
    assert.equal(evt.event, 'error');
    assert.equal(evt.payload.message, 'No text to synthesize');
  });

  test('validators preserve nested tts.local.streaming defaults', () => {
    const voice = defaultVoiceConfig(true);
    assert.deepEqual(voice.tts.local.streaming, {
      emitEveryFrames: 8,
      decodeWindowFrames: 80,
      firstChunkEmitEvery: 5,
      firstChunkDecodeWindow: 48,
      overlapSamples: 512,
      repetitionPenalty: 1.05,
    });

    const merged = normalizeVoiceConfig({
      tts: { local: { streaming: { emitEveryFrames: 12 } } },
    });
    assert.equal(merged.tts.local.streaming.emitEveryFrames, 12);
    assert.equal(merged.tts.local.streaming.decodeWindowFrames, 80);
  });
});

describe('TTS stream worker source contract', () => {
  test('worker.py defines TtsStreamSession, /tts/stream, and GPU lock around stream', () => {
    const src = readFileSync(WORKER_PY, 'utf8');
    assert.match(src, /class TtsStreamSession:/);
    assert.match(src, /class SttStreamSession:/);
    assert.match(src, /self\.path == "\/tts\/stream"/);
    assert.match(src, /enable_streaming_optimizations/);
    assert.match(src, /with _gpu_inference_lock:\s*\n\s*for pcm_chunk, sample_rate in _iter_tts_stream_chunks/);
    assert.match(src, /op == "start"/);
    assert.match(src, /op == "append"/);
    assert.match(src, /op == "finish"/);
    assert.match(src, /self\._sse\(\s*["']chunk["']/);
    assert.match(src, /self\._sse\(\s*["']final["']/);
    assert.match(src, /self\._sse\(\s*["']error["']/);
  });

  test('provision.js pins qwen-tts streaming fork and documents MINNOW_TTS_USE_COMPILE', () => {
    const src = readFileSync(PROVISION_JS, 'utf8');
    assert.match(src, /Qwen3-TTS-streaming\.git/);
    assert.match(src, /flash-attn/);
    assert.match(src, /MINNOW_TTS_USE_COMPILE/);
    assert.match(src, /patchQwenTtsCheckModelInputs/);
    assert.match(src, /@check_model_inputs\(\)/);
  });
});
