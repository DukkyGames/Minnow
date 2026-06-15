/**
 * Dual-residency tests — STT and TTS can be loaded independently in the worker.
 * Status builders must use kind-specific readiness, not legacy modelLoaded alone.
 */

import assert from 'node:assert/strict';
import { describe, test, after } from 'node:test';
import { buildLocalSttStatus, resetLocalSttForTests } from '../../server/voice/local-stt.js';
import { buildLocalTtsStatus, resetLocalTtsForTests } from '../../server/voice/local-tts.js';
import {
  resetVoiceFetchOverrideForTests,
  resetVoiceRuntimeForTests,
  setVoiceFetchOverrideForTests,
  setWorkerStateForTests,
} from '../../server/voice/runtime-manager.js';

/** Mock worker /voice/capabilities for dual-residency scenarios. */
function mockCapabilities(caps) {
  setVoiceFetchOverrideForTests(async (url) => {
    if (String(url).endsWith('/voice/capabilities')) {
      return new Response(JSON.stringify(caps), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
}

function mockRunningWorker(port = 9888) {
  setWorkerStateForTests({
    child: null,
    port,
    healthy: true,
    phase: 'running',
  });
}

const sttVoice = {
  stt: {
    backend: 'local',
    local: { modelId: 'openai/whisper-base', language: '' },
    model: 'openai/whisper-base',
  },
};

const ttsVoice = {
  tts: {
    backend: 'local',
    local: {
      modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      mode: 'custom_voice',
    },
    model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
  },
};

after(() => {
  resetVoiceRuntimeForTests();
  resetVoiceFetchOverrideForTests();
  resetLocalSttForTests();
  resetLocalTtsForTests();
});

describe('dual-residency status', () => {
  test('STT status modelLoaded is true only when sttLoaded', async () => {
    mockRunningWorker();
    mockCapabilities({
      cuda: true,
      sttLoaded: true,
      ttsLoaded: false,
      loadedSttModelId: 'openai/whisper-base',
      loadedTtsModelId: null,
      modelLoaded: true,
      loadedKind: 'stt',
    });

    const status = await buildLocalSttStatus(sttVoice);
    assert.equal(status.modelLoaded, true);
  });

  test('TTS status modelLoaded is true only when ttsLoaded', async () => {
    mockRunningWorker();
    mockCapabilities({
      cuda: true,
      sttLoaded: false,
      ttsLoaded: true,
      loadedSttModelId: null,
      loadedTtsModelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      loadedTtsMode: 'custom_voice',
      modelLoaded: true,
      loadedKind: 'tts',
      speakers: ['Ryan'],
      languages: ['English'],
    });

    const status = await buildLocalTtsStatus(ttsVoice);
    assert.equal(status.modelLoaded, true);
  });

  test('when only TTS is loaded, STT status does not show modelLoaded', async () => {
    mockRunningWorker();
    mockCapabilities({
      cuda: true,
      sttLoaded: false,
      ttsLoaded: true,
      loadedSttModelId: null,
      loadedTtsModelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      loadedTtsMode: 'custom_voice',
      modelLoaded: true,
      loadedKind: 'tts',
      speakers: ['Ryan'],
      languages: ['English'],
    });

    const sttStatus = await buildLocalSttStatus(sttVoice);
    assert.equal(sttStatus.modelLoaded, false);
    assert.equal(sttStatus.warning, 'Model will load on first transcription');
  });

  test('when only STT is loaded, TTS status does not show modelLoaded', async () => {
    mockRunningWorker();
    mockCapabilities({
      cuda: true,
      sttLoaded: true,
      ttsLoaded: false,
      loadedSttModelId: 'openai/whisper-base',
      loadedTtsModelId: null,
      modelLoaded: true,
      loadedKind: 'stt',
    });

    const ttsStatus = await buildLocalTtsStatus(ttsVoice);
    assert.equal(ttsStatus.modelLoaded, false);
    assert.equal(ttsStatus.warning, 'Model will load on first synthesis');
  });

  test('when both are loaded, each status reports its own modelLoaded', async () => {
    mockRunningWorker();
    mockCapabilities({
      cuda: true,
      sttLoaded: true,
      ttsLoaded: true,
      loadedSttModelId: 'openai/whisper-base',
      loadedTtsModelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      loadedTtsMode: 'custom_voice',
      modelLoaded: true,
      loadedKind: 'stt',
      speakers: ['Ryan'],
      languages: ['English'],
    });

    const sttStatus = await buildLocalSttStatus(sttVoice);
    const ttsStatus = await buildLocalTtsStatus(ttsVoice);
    assert.equal(sttStatus.modelLoaded, true);
    assert.equal(ttsStatus.modelLoaded, true);
    assert.equal(sttStatus.warning, null);
    assert.equal(ttsStatus.warning, null);
  });
});
