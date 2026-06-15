/**
 * TTS synthesis validation and cache tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  hashTtsParams,
  getCachedSynthesis,
  putCachedSynthesis,
  readTtsCache,
} from '../../server/tts/cache.js';
import {
  MAX_TTS_TEXT_CHARS,
  buildTtsStatus,
  normalizeTtsSpeed,
} from '../../server/tts/middleware.js';
import { normalizeVoiceConfig } from '../../server/config/validators.js';
import {
  resetVoiceFetchOverrideForTests,
  resetVoiceRuntimeForTests,
  setVoiceFetchOverrideForTests,
  setWorkerStateForTests,
} from '../../server/voice/runtime-manager.js';
import { resetLocalTtsForTests } from '../../server/voice/local-tts.js';

describe('tts speed validation', () => {
  test('normalizeTtsSpeed clamps malformed values', () => {
    assert.equal(normalizeTtsSpeed(99, 1), 4);
    assert.equal(normalizeTtsSpeed(0.1, 1), 0.25);
    assert.equal(normalizeTtsSpeed('bad', 1.5), 1.5);
  });

  test('voice config clamps tts provider speed on save', () => {
    const voice = normalizeVoiceConfig({
      tts: { backend: 'provider', speed: 9 },
    });
    assert.equal(voice.tts.provider.speed, 4);
    assert.equal(voice.tts.speed, 4);
  });
});

describe('tts cache', () => {
  let previousHome = '';

  before(() => {
    previousHome = process.env.MINNOW_HOME ?? '';
    process.env.MINNOW_HOME = path.join(
      os.tmpdir(),
      `minnow-tts-cache-${Date.now()}`,
    );
  });

  after(async () => {
    process.env.MINNOW_HOME = previousHome;
    const { resetMinnowHomeCache } = await import('../../server/config/home.js');
    resetMinnowHomeCache();
  });

  test('hashTtsParams is stable for identical input', () => {
    const a = hashTtsParams('hello', 'alloy', 1, 'mp3');
    const b = hashTtsParams('hello', 'alloy', 1, 'mp3');
    assert.equal(a, b);
    assert.notEqual(a, hashTtsParams('hello', 'nova', 1, 'mp3'));
  });

  test('putCachedSynthesis writes retrievable audio bytes', async () => {
    const fakeMp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const id = await putCachedSynthesis(
      'cache test',
      'alloy',
      1,
      'mp3',
      fakeMp3,
      'audio/mpeg',
    );
    const cached = await readTtsCache(id);
    assert.ok(cached);
    assert.equal(cached.mime, 'audio/mpeg');
    assert.deepEqual(cached.data, fakeMp3);
    const dir = path.join(process.env.MINNOW_HOME, 'tts-cache');
    const files = await fs.readdir(dir);
    assert.ok(files.some((name) => name.endsWith('.audio')));
  });

  test('getCachedSynthesis hits local TTS cache keyed by modelId', async () => {
    const modelId = 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';
    const fakeWav = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const id = await putCachedSynthesis('local cache phrase', modelId, 1, 'wav', fakeWav, 'audio/wav');
    const cached = await getCachedSynthesis('local cache phrase', modelId, 1, 'wav');
    assert.ok(cached);
    assert.equal(cached.id, id);
    assert.equal(hashTtsParams('local cache phrase', modelId, 1, 'wav'), id);
  });
});

describe('tts text limits', () => {
  test('MAX_TTS_TEXT_CHARS matches OpenAI guidance', () => {
    assert.equal(MAX_TTS_TEXT_CHARS, 4096);
  });
});

describe('tts local status', () => {
  after(() => {
    resetVoiceRuntimeForTests();
    resetVoiceFetchOverrideForTests();
    resetLocalTtsForTests();
  });

  test('buildTtsStatus reports local backend fields', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9878,
      healthy: true,
      phase: 'running',
    });
    setVoiceFetchOverrideForTests(async (url) => {
      if (String(url).endsWith('/voice/capabilities')) {
        return new Response(
          JSON.stringify({
            cuda: false,
            modelLoaded: false,
            loadedKind: null,
            speakers: [],
            languages: [],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    const voice = normalizeVoiceConfig({ tts: { backend: 'local', enabled: true } });
    const status = await buildTtsStatus(voice);
    assert.equal(status.backend, 'local');
    assert.equal(status.enabled, true);
    assert.equal(status.runtimeReady, true);
    assert.equal(status.streamingSupported, true);
    assert.match(status.warning ?? '', /first synthesis/i);
  });

  test('buildTtsStatus disables streamingSupported when streaming is off', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9878,
      healthy: true,
      phase: 'running',
    });
    setVoiceFetchOverrideForTests(async (url) => {
      if (String(url).endsWith('/voice/capabilities')) {
        return new Response(JSON.stringify({ ttsLoaded: true, loadedKind: 'tts' }), {
          status: 200,
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const voice = normalizeVoiceConfig({
      tts: { backend: 'local', enabled: true, streaming: false },
    });
    const status = await buildTtsStatus(voice);
    assert.equal(status.streamingSupported, false);
    assert.equal(status.streaming, false);
  });
});
