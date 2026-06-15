/**
 * Preload configured STT/TTS models into the voice worker after startup.
 * Failures are logged but do not block worker start.
 */

import { loadVoiceConfig } from './config.js';
import { resolveLocalModelPath } from './local-stt.js';
import { resolveLocalTtsModelPath } from './local-tts.js';
import { getWorkerPort, getWorkerFetch } from './runtime-manager.js';

/**
 * POST /models/load for one voice kind; logs and swallows errors.
 * @param {string} port
 * @param {typeof fetch} fetchImpl
 * @param {'stt' | 'tts'} kind
 * @param {object} body
 */
async function preloadOneModel(port, fetchImpl, kind, body) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/models/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...body }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(
        `[voice] preload ${kind} failed (${res.status}): ${detail || 'unknown error'}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[voice] preload ${kind} failed: ${message}`);
  }
}

/**
 * Load configured local STT/TTS models in parallel when the worker is healthy.
 */
export async function preloadVoiceModels() {
  const port = getWorkerPort();
  if (!port) {
    return;
  }

  const voice = await loadVoiceConfig();
  const fetchImpl = getWorkerFetch();
  const tasks = [];

  if (voice.stt?.backend === 'local' && voice.stt.local) {
    const modelId = voice.stt.local.modelId ?? voice.stt.model;
    if (modelId) {
      tasks.push(
        resolveLocalModelPath(modelId).then((modelPath) =>
          preloadOneModel(port, fetchImpl, 'stt', {
            modelId,
            modelPath,
            config: voice.stt.local,
          }),
        ),
      );
    }
  }

  if (voice.tts?.backend === 'local' && voice.tts.local) {
    const modelId = voice.tts.local.modelId ?? voice.tts.model;
    if (modelId) {
      tasks.push(
        (async () => {
          const modelPath = await resolveLocalTtsModelPath(modelId);
          const tokenizerModelId = voice.tts.local.tokenizerModelId;
          const tokenizerPath = tokenizerModelId
            ? await resolveLocalTtsModelPath(String(tokenizerModelId))
            : '';
          await preloadOneModel(port, fetchImpl, 'tts', {
            modelId,
            modelPath,
            tokenizerPath,
            config: voice.tts.local,
          });
        })(),
      );
    }
  }

  if (tasks.length === 0) {
    return;
  }

  await Promise.all(tasks);
}
