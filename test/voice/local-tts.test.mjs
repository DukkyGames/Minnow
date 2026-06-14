/**
 * Local TTS bridge tests — worker HTTP forwarding when backend=local.
 */

import assert from 'node:assert/strict';
import { describe, test, after } from 'node:test';
import {
  buildLocalTtsStatus,
  resetLocalTtsForTests,
  synthesizeLocal,
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

describe('local TTS bridge', () => {
  test('synthesizeLocal loads model then posts text to worker', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9877,
      healthy: true,
      phase: 'running',
    });

    const calls = [];
    setVoiceFetchOverrideForTests(async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith('/models/load')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (String(url).endsWith('/tts/synthesize')) {
        const audio = Buffer.from('RIFF').toString('base64');
        return new Response(
          JSON.stringify({ audioBase64: audio, mime: 'audio/wav' }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    const result = await synthesizeLocal({
      localConfig: {
        modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        deviceMap: 'auto',
        dtype: 'bfloat16',
        attnImplementation: 'auto',
        tokenizerModelId: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
        mode: 'custom_voice',
        customVoice: { speaker: 'Ryan', language: 'Auto', instruct: '' },
        voiceDesign: { language: 'Auto', instruct: '' },
        voiceClone: {
          refAudioPath: '',
          refText: '',
          xVectorOnlyMode: false,
          language: 'Auto',
          savedPromptId: '',
        },
        generation: {
          maxNewTokens: 2048,
          topP: 1,
          topK: 50,
          temperature: 0.9,
          repetitionPenalty: 1,
        },
      },
      text: 'hello local tts',
    });

    assert.equal(result.mime, 'audio/wav');
    assert.ok(result.buffer.length > 0);
    assert.ok(calls.some((u) => u.endsWith('/models/load')));
    assert.ok(calls.some((u) => u.endsWith('/tts/synthesize')));
  });

  test('buildLocalTtsStatus reports backend and runtime fields', async () => {
    setWorkerStateForTests({
      child: null,
      port: 9877,
      healthy: true,
      phase: 'running',
    });

    setVoiceFetchOverrideForTests(async (url) => {
      if (String(url).endsWith('/voice/capabilities')) {
        return new Response(
          JSON.stringify({
            cuda: true,
            modelLoaded: true,
            loadedKind: 'tts',
            speakers: ['Ryan'],
            languages: ['English'],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    const voice = {
      tts: {
        backend: 'local',
        local: {
          modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
          mode: 'custom_voice',
        },
        model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      },
    };

    const status = await buildLocalTtsStatus(voice);
    assert.equal(status.backend, 'local');
    assert.equal(status.modelId, 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice');
    assert.equal(status.mode, 'custom_voice');
    assert.equal(status.runtimeReady, true);
    assert.equal(status.modelLoaded, true);
    assert.deepEqual(status.speakers, ['Ryan']);
  });
});
