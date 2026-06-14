/**
 * Local STT bridge — Node middleware → Python voice worker HTTP API.
 */

import { loadVoiceConfig } from './config.js';
import { getWorkerPort, getWorkerFetch } from './runtime-manager.js';
import { voiceModelDir } from './paths.js';
import fsp from 'node:fs/promises';

/** @type {string | null} */
let loadedModelId = null;

/**
 * Resolve the on-disk path for a voice STT model.
 * @param {string} modelId
 */
export async function resolveLocalModelPath(modelId) {
  const dest = voiceModelDir(modelId);
  try {
    await fsp.access(dest);
    return dest;
  } catch {
    return modelId;
  }
}

/**
 * Fetch worker /voice/capabilities when the worker is running.
 */
export async function fetchWorkerCapabilities() {
  const port = getWorkerPort();
  if (!port) {
    return { cuda: false, flashAttnAvailable: false, modelLoaded: false };
  }
  const fetchImpl = getWorkerFetch();
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/voice/capabilities`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return { cuda: false, flashAttnAvailable: false, modelLoaded: false };
    }
    const json = await res.json();
    return {
      cuda: json?.cuda === true,
      flashAttnAvailable: json?.flashAttnAvailable === true,
      modelLoaded: json?.modelLoaded === true,
      loadedModelId: typeof json?.loadedModelId === 'string' ? json.loadedModelId : null,
      loadedKind: typeof json?.loadedKind === 'string' ? json.loadedKind : null,
      speakers: Array.isArray(json?.speakers) ? json.speakers : [],
      languages: Array.isArray(json?.languages) ? json.languages : [],
    };
  } catch {
    return { cuda: false, flashAttnAvailable: false, modelLoaded: false };
  }
}

/**
 * Whether the worker already has the requested STT model resident.
 * @param {string} modelId
 */
async function isSttModelReady(modelId) {
  const caps = await fetchWorkerCapabilities();
  return (
    caps.modelLoaded === true &&
    caps.loadedKind === 'stt' &&
    caps.loadedModelId === modelId
  );
}

/**
 * Ask the worker to load an STT model.
 * @param {string} modelId
 * @param {Record<string, unknown>} config
 */
export async function ensureSttModelLoaded(modelId, config) {
  const port = getWorkerPort();
  if (!port) {
    throw new Error('Voice worker is not running. Start it from Models → Voice.');
  }
  if (loadedModelId === modelId && (await isSttModelReady(modelId))) {
    return;
  }
  loadedModelId = null;

  const modelPath = await resolveLocalModelPath(modelId);
  const fetchImpl = getWorkerFetch();
  const res = await fetchImpl(`http://127.0.0.1:${port}/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'stt', modelId, modelPath, config }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Model load failed (${res.status})`);
  }
  loadedModelId = modelId;
}

/**
 * Transcribe audio via the local voice worker.
 * @param {object} params
 */
export async function transcribeLocal(params) {
  const { localConfig, audioBuffer, mime, filename } = params;
  const port = getWorkerPort();
  if (!port) {
    throw new Error('Voice worker is not running. Start it from Models → Voice.');
  }

  await ensureSttModelLoaded(localConfig.modelId, localConfig);

  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mime || 'audio/webm' });
  form.append('file', blob, filename || 'audio.webm');
  form.append('config', JSON.stringify(localConfig));

  const fetchImpl = getWorkerFetch();
  const res = await fetchImpl(`http://127.0.0.1:${port}/stt/transcribe`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Local transcription failed (${res.status})`);
  }
  const json = await res.json();
  const text = typeof json.text === 'string' ? json.text.trim() : '';
  return text;
}

/**
 * Build extended STT status for local backend.
 * @param {Awaited<ReturnType<typeof loadVoiceConfig>>} voice
 */
export async function buildLocalSttStatus(voice) {
  const stt = voice.stt;
  const port = getWorkerPort();
  const runtimeReady = port != null;
  const caps = runtimeReady ? await fetchWorkerCapabilities() : null;
  const modelId = stt.local?.modelId ?? stt.model;
  let warning = null;
  if (stt.backend === 'local' && !runtimeReady) {
    warning = 'Voice worker is not running';
  } else if (stt.backend === 'local' && caps && !caps.modelLoaded) {
    warning = 'Model will load on first transcription';
  }

  return {
    backend: stt.backend,
    modelId,
    runtimeReady,
    modelLoaded: caps?.modelLoaded === true,
    cudaAvailable: caps?.cuda === true,
    warning,
  };
}

/** @internal Test helper */
export function resetLocalSttForTests() {
  loadedModelId = null;
}
