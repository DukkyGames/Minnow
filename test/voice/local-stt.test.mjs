/**
 * Local STT bridge tests — worker HTTP forwarding when backend=local.
 */

import assert from 'node:assert/strict';
import { describe, test, after } from 'node:test';
import {
  buildLocalSttStatus,
  resetLocalSttForTests,
  transcribeLocal,
} from '../../server/voice/local-stt.js';
import {
  resetVoiceFetchOverrideForTests,
  resetVoiceRuntimeForTests,
  setVoiceFetchOverrideForTests,
  setWorkerStateForTests,
} from '../../server/voice/runtime-manager.js';

after(() => {
  resetVoiceRuntimeForTests();
  resetVoiceFetchOverrideForTests();
  resetLocalSttForTests();
});

describe('local STT bridge', () => {
  test('transcribeLocal loads model then posts audio to worker', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9876,
      healthy: true,
      phase: 'running',
    });

    const calls = [];
    setVoiceFetchOverrideForTests(async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith('/models/load')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(url).endsWith('/stt/transcribe')) {
        return new Response(JSON.stringify({ text: 'hello local' }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    const text = await transcribeLocal({
      localConfig: {
        modelId: 'openai/whisper-tiny',
        language: '',
        task: 'transcribe',
        longFormAlgorithm: 'chunked',
        chunkLengthSeconds: 30,
        batchSize: 1,
        returnTimestamps: false,
        timestampGranularity: 'segment',
        maxNewTokens: 448,
        numBeams: 1,
        conditionOnPrevTokens: false,
        compressionRatioThreshold: 1.35,
        temperatureFallback: true,
        temperature: 0,
        logprobThreshold: -1,
        noSpeechThreshold: 0.6,
        device: 'auto',
        computeType: 'auto',
        attnImplementation: 'auto',
        useSafetensors: true,
        lowCpuMemUsage: true,
        torchCompile: false,
      },
      audioBuffer: Buffer.from('audio-bytes'),
      mime: 'audio/webm',
      filename: 'audio.webm',
    });

    assert.equal(text, 'hello local');
    assert.ok(calls.some((u) => u.endsWith('/models/load')));
    assert.ok(calls.some((u) => u.endsWith('/stt/transcribe')));
  });

  test('buildLocalSttStatus reports backend and runtime fields', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9876,
      healthy: true,
      phase: 'running',
    });

    setVoiceFetchOverrideForTests(async (url) => {
      if (String(url).endsWith('/voice/capabilities')) {
        return new Response(
          JSON.stringify({
            cuda: true,
            flashAttnAvailable: false,
            modelLoaded: true,
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    const voice = {
      stt: {
        backend: 'local',
        local: { modelId: 'openai/whisper-base', language: '' },
        model: 'openai/whisper-base',
      },
    };

    const status = await buildLocalSttStatus(voice);
    assert.equal(status.backend, 'local');
    assert.equal(status.modelId, 'openai/whisper-base');
    assert.equal(status.runtimeReady, true);
    assert.equal(status.modelLoaded, true);
    assert.equal(status.cudaAvailable, true);
  });
});
