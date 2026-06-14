/**
 * Local TTS bridge — Node middleware → Python voice worker HTTP API.
 */

import fsp from 'node:fs/promises';
import { getWorkerPort, getWorkerFetch } from './runtime-manager.js';
import { voiceModelDir } from './paths.js';
import { fetchWorkerCapabilities } from './local-stt.js';

/** @type {string | null} */
let loadedModelId = null;

/**
 * Resolve the on-disk path for a voice TTS model.
 * @param {string} modelId
 */
export async function resolveLocalTtsModelPath(modelId) {
  const dest = voiceModelDir(modelId);
  try {
    await fsp.access(dest);
    return dest;
  } catch {
    return modelId;
  }
}

/**
 * Ask the worker to load a TTS model.
 * @param {string} modelId
 * @param {Record<string, unknown>} config
 */
export async function ensureTtsModelLoaded(modelId, config) {
  const port = getWorkerPort();
  if (!port) {
    throw new Error('Voice worker is not running. Start it from Models → Voice.');
  }
  if (loadedModelId === modelId) {
    return;
  }

  const modelPath = await resolveLocalTtsModelPath(modelId);
  const tokenizerPath = config.tokenizerModelId
    ? await resolveLocalTtsModelPath(String(config.tokenizerModelId))
    : '';

  const fetchImpl = getWorkerFetch();
  const res = await fetchImpl(`http://127.0.0.1:${port}/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'tts',
      modelId,
      modelPath,
      tokenizerPath,
      config,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `TTS model load failed (${res.status})`);
  }
  loadedModelId = modelId;
}

/**
 * Synthesize speech via the local voice worker.
 * @param {object} params
 */
export async function synthesizeLocal(params) {
  const { localConfig, text } = params;
  const port = getWorkerPort();
  if (!port) {
    throw new Error('Voice worker is not running. Start it from Models → Voice.');
  }

  await ensureTtsModelLoaded(localConfig.modelId, localConfig);

  const fetchImpl = getWorkerFetch();
  const res = await fetchImpl(`http://127.0.0.1:${port}/tts/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, config: localConfig }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Local synthesis failed (${res.status})`);
  }
  const json = await res.json();
  const audioBase64 = typeof json.audioBase64 === 'string' ? json.audioBase64 : '';
  if (!audioBase64) {
    throw new Error('Worker returned empty audio');
  }
  const mime = typeof json.mime === 'string' ? json.mime : 'audio/wav';
  return { buffer: Buffer.from(audioBase64, 'base64'), mime };
}

/**
 * Build extended TTS status for local backend.
 * @param {Awaited<ReturnType<import('./config.js').loadVoiceConfig>>} voice
 */
export async function buildLocalTtsStatus(voice) {
  const tts = voice.tts;
  const port = getWorkerPort();
  const runtimeReady = port != null;
  const caps = runtimeReady ? await fetchWorkerCapabilities() : null;
  const modelId = tts.local?.modelId ?? tts.model;
  const mode = tts.local?.mode ?? 'custom_voice';
  let warning = null;
  if (tts.backend === 'local' && !runtimeReady) {
    warning = 'Voice worker is not running';
  } else if (tts.backend === 'local' && caps && !caps.modelLoaded) {
    warning = 'Model will load on first synthesis';
  }

  return {
    backend: tts.backend,
    modelId,
    mode,
    runtimeReady,
    modelLoaded: caps?.modelLoaded === true && caps?.loadedKind === 'tts',
    warning,
    speakers: Array.isArray(caps?.speakers) ? caps.speakers : [],
    languages: Array.isArray(caps?.languages) ? caps.languages : [],
  };
}

/** @internal Test helper */
export function resetLocalTtsForTests() {
  loadedModelId = null;
}
