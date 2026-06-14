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
  putCachedSynthesis,
  readTtsCache,
} from '../../server/tts/cache.js';
import {
  MAX_TTS_TEXT_CHARS,
  normalizeTtsSpeed,
} from '../../server/tts/middleware.js';
import { normalizeVoiceConfig } from '../../server/config/validators.js';

describe('tts speed validation', () => {
  test('normalizeTtsSpeed clamps malformed values', () => {
    assert.equal(normalizeTtsSpeed(99, 1), 4);
    assert.equal(normalizeTtsSpeed(0.1, 1), 0.25);
    assert.equal(normalizeTtsSpeed('bad', 1.5), 1.5);
  });

  test('voice config clamps tts speed on save', () => {
    const voice = normalizeVoiceConfig({
      tts: { speed: 9 },
    });
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
});

describe('tts text limits', () => {
  test('MAX_TTS_TEXT_CHARS matches OpenAI guidance', () => {
    assert.equal(MAX_TTS_TEXT_CHARS, 4096);
  });
});
