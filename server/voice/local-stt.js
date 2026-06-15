/**
 * Local STT bridge — Node middleware → Python voice worker HTTP API.
 */

import { loadVoiceConfig } from './config.js';
import { getWorkerPort, getWorkerFetch } from './runtime-manager.js';
import { voiceModelDir } from './paths.js';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** @type {string | null} */
let loadedModelId = null;

/**
 * Whether a voice model directory contains a faster-whisper CTranslate2 snapshot.
 * @param {string} destDir
 */
async function isCtranslate2ModelDir(destDir) {
  try {
    await fsp.access(path.join(destDir, 'model.bin'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the on-disk path for a voice STT model.
 * HF transformers snapshots are ignored — faster-whisper loads by size alias instead.
 * @param {string} modelId
 */
export async function resolveLocalModelPath(modelId) {
  const dest = voiceModelDir(modelId);
  try {
    await fsp.access(dest);
    if (await isCtranslate2ModelDir(dest)) {
      return dest;
    }
    return modelId;
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
 * @typedef {{ type: 'segment', text: string } | { type: 'partial', text: string } | { type: 'error', message: string }} SttStreamWorkerEvent
 */

/**
 * Open a streaming STT session against the Python worker SSE endpoint.
 * @param {{ localConfig: Record<string, unknown>, onEvent?: (event: SttStreamWorkerEvent) => void }} params
 */
export function createLocalSttStream(params) {
  const { localConfig, onEvent } = params;
  /** @type {import('node:stream').PassThrough | null} */
  let pcmStream = null;
  /** @type {AbortController | null} */
  let abortController = null;
  /** @type {Promise<string> | null} */
  let closePromise = null;
  let accumulated = '';
  let opened = false;

  return {
    async open() {
      if (opened) return;
      opened = true;
      const port = getWorkerPort();
      if (!port) {
        throw new Error('Voice worker is not running. Start it from Models → Voice.');
      }
      await ensureSttModelLoaded(localConfig.modelId, localConfig);

      const { PassThrough } = await import('node:stream');
      pcmStream = new PassThrough();
      abortController = new AbortController();

      const fetchImpl = getWorkerFetch();
      const responsePromise = fetchImpl(`http://127.0.0.1:${port}/stt/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Stt-Config': JSON.stringify(localConfig),
        },
        body: pcmStream,
        duplex: 'half',
        signal: abortController.signal,
      });

      /** @type {((text: string) => void) | null} */
      let resolveClose = null;
      closePromise = new Promise((resolve) => {
        resolveClose = resolve;
      });

      void responsePromise.then(async (res) => {
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          onEvent?.({ type: 'error', message: detail || `Stream failed (${res.status})` });
          resolveClose?.(accumulated);
          return;
        }
        if (!res.body) {
          resolveClose?.(accumulated);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            parseSseBlock(part, onEvent, {
              onSegment: (text) => {
                accumulated = joinStreamText(accumulated, text);
              },
              onFinal: (text) => {
                accumulated = text.trim() || accumulated;
              },
            });
          }
        }
        if (buffer.trim()) {
          parseSseBlock(buffer, onEvent, {
            onSegment: (text) => {
              accumulated = joinStreamText(accumulated, text);
            },
            onFinal: (text) => {
              accumulated = text.trim() || accumulated;
            },
          });
        }
        resolveClose?.(accumulated);
      }).catch((err) => {
        if (!abortController?.signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          onEvent?.({ type: 'error', message });
        }
        resolveClose?.(accumulated);
      });
    },

    writePcm(chunk) {
      pcmStream?.write(chunk);
    },

    async close() {
      pcmStream?.end();
      if (closePromise) {
        return closePromise;
      }
      return accumulated;
    },

    async abort() {
      pcmStream?.destroy();
      abortController?.abort();
    },
  };
}

/**
 * @param {string} block
 * @param {(event: SttStreamWorkerEvent) => void | undefined} onEvent
 * @param {{ onSegment: (text: string) => void, onFinal: (text: string) => void }} handlers
 */
function parseSseBlock(block, onEvent, handlers) {
  const lines = block.split('\n');
  let eventName = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }
  if (!data) return;
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }
  if (eventName === 'segment' && typeof payload.text === 'string') {
    handlers.onSegment(payload.text);
    onEvent?.({ type: 'segment', text: payload.text });
  } else if (eventName === 'partial' && typeof payload.text === 'string') {
    onEvent?.({ type: 'partial', text: payload.text });
  } else if (eventName === 'error' && typeof payload.message === 'string') {
    onEvent?.({ type: 'error', message: payload.message });
  } else if (eventName === 'final' && typeof payload.text === 'string') {
    handlers.onFinal(payload.text);
  }
}

/**
 * @param {string} left
 * @param {string} right
 */
function joinStreamText(left, right) {
  const trimmed = String(right || '').trim();
  if (!trimmed) return left;
  if (!left) return trimmed;
  const spacer = !left.endsWith(' ') && !trimmed.startsWith(' ') ? ' ' : '';
  return `${left}${spacer}${trimmed}`;
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
