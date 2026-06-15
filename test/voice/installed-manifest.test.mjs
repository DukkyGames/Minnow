/**
 * Voice installed manifest rebuild from on-disk model snapshots.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  listInstalledVoiceModels,
  resetVoiceDownloadsForTests,
} from '../../server/voice/download.js';
import { getVoiceInstalledPath, getVoiceModelsRoot } from '../../server/voice/paths.js';

describe('voice installed manifest rebuild', () => {
  let homeDir = '';

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-voice-manifest-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await resetVoiceDownloadsForTests();
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await resetVoiceDownloadsForTests();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('rebuilds installed.json from HF snapshot folders when manifest is missing', async () => {
    const modelsRoot = getVoiceModelsRoot();
    const sttDir = path.join(modelsRoot, 'openai--whisper-small');
    const ttsDir = path.join(modelsRoot, 'Qwen--Qwen3-TTS-12Hz-0.6B-CustomVoice');
    await fs.mkdir(sttDir, { recursive: true });
    await fs.mkdir(ttsDir, { recursive: true });
    await fs.writeFile(path.join(sttDir, 'config.json'), '{"model_type":"whisper"}\n', 'utf8');
    await fs.writeFile(path.join(ttsDir, 'config.json'), '{"model_type":"qwen3_tts"}\n', 'utf8');

    const manifest = await listInstalledVoiceModels();

    assert.ok(
      manifest.stt.some((row) => row.modelId === 'openai/whisper-small'),
      'expected STT model rebuilt from disk',
    );
    assert.ok(
      manifest.tts.some(
        (row) =>
          row.modelId === 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice' && row.mode === 'custom_voice',
      ),
      'expected TTS model rebuilt from disk with catalog mode',
    );

    const raw = await fs.readFile(getVoiceInstalledPath(), 'utf8');
    const persisted = JSON.parse(raw);
    assert.equal(persisted.stt.length, 1);
    assert.equal(persisted.tts.length, 1);
  });
});
