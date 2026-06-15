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
 * Whether the worker already has the requested TTS model resident.
 * @param {string} modelId
 */
async function isTtsModelReady(modelId) {
  const caps = await fetchWorkerCapabilities();
  const ttsReady = caps.ttsLoaded === true || caps.loadedKind === 'tts';
  const loadedId = caps.loadedTtsModelId ?? caps.loadedModelId;
  return ttsReady && loadedId === modelId;
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
  if (loadedModelId === modelId && (await isTtsModelReady(modelId))) {
    return;
  }
  loadedModelId = null;

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
 * @typedef {{ type: 'chunk', pcm: Buffer, sampleRate: number, frameIndex: number } | { type: 'final', durationMs?: number } | { type: 'error', message: string }} TtsStreamWorkerEvent
 */

/**
 * Open a streaming TTS session against the Python worker SSE endpoint.
 * @param {{ localConfig: Record<string, unknown>, onEvent?: (event: TtsStreamWorkerEvent) => void }} params
 */
export function createLocalTtsStream(params) {
  const { localConfig, onEvent } = params;
  /** @type {import('node:stream').PassThrough | null} */
  let ndjsonStream = null;
  /** @type {AbortController | null} */
  let abortController = null;
  /** @type {Promise<{ durationMs?: number }> | null} */
  let finishPromise = null;
  let opened = false;
  let firstTextWrite = true;
  let finished = false;
  let durationMs = undefined;

  return {
    async open() {
      if (opened) return;
      opened = true;
      const port = getWorkerPort();
      if (!port) {
        throw new Error('Voice worker is not running. Start it from Models → Voice.');
      }
      await ensureTtsModelLoaded(localConfig.modelId, localConfig);

      const { PassThrough } = await import('node:stream');
      ndjsonStream = new PassThrough();
      abortController = new AbortController();

      const fetchImpl = getWorkerFetch();
      const responsePromise = fetchImpl(`http://127.0.0.1:${port}/tts/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Tts-Config': JSON.stringify(localConfig),
        },
        body: ndjsonStream,
        duplex: 'half',
        signal: abortController.signal,
      });

      /** @type {((result: { durationMs?: number }) => void) | null} */
      let resolveFinish = null;
      finishPromise = new Promise((resolve) => {
        resolveFinish = resolve;
      });

      void responsePromise.then(async (res) => {
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          onEvent?.({ type: 'error', message: detail || `Stream failed (${res.status})` });
          resolveFinish?.({ durationMs });
          return;
        }
        if (!res.body) {
          resolveFinish?.({ durationMs });
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
            parseTtsSseBlock(part, onEvent, {
              onFinal: (ms) => {
                durationMs = ms;
              },
            });
          }
        }
        if (buffer.trim()) {
          parseTtsSseBlock(buffer, onEvent, {
            onFinal: (ms) => {
              durationMs = ms;
            },
          });
        }
        resolveFinish?.({ durationMs });
      }).catch((err) => {
        if (!abortController?.signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          onEvent?.({ type: 'error', message });
        }
        resolveFinish?.({ durationMs });
      });
    },

    writeText(text) {
      const trimmed = String(text || '');
      if (!trimmed || !ndjsonStream) return;
      const op = firstTextWrite ? 'start' : 'append';
      firstTextWrite = false;
      ndjsonStream.write(`${JSON.stringify({ op, text: trimmed })}\n`);
    },

    async finish() {
      if (finished) {
        return finishPromise ?? { durationMs };
      }
      finished = true;
      ndjsonStream?.write(`${JSON.stringify({ op: 'finish' })}\n`);
      ndjsonStream?.end();
      if (finishPromise) {
        return finishPromise;
      }
      return { durationMs };
    },

    async abort() {
      ndjsonStream?.destroy();
      abortController?.abort();
    },
  };
}

/**
 * @param {string} block
 * @param {(event: TtsStreamWorkerEvent) => void | undefined} onEvent
 * @param {{ onFinal: (durationMs?: number) => void }} handlers
 */
function parseTtsSseBlock(block, onEvent, handlers) {
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
  if (eventName === 'chunk' && typeof payload.pcmBase64 === 'string') {
    const pcm = Buffer.from(payload.pcmBase64, 'base64');
    const sampleRate =
      typeof payload.sampleRate === 'number' ? payload.sampleRate : 24000;
    const frameIndex =
      typeof payload.frameIndex === 'number' ? payload.frameIndex : 0;
    onEvent?.({ type: 'chunk', pcm, sampleRate, frameIndex });
  } else if (eventName === 'error' && typeof payload.message === 'string') {
    onEvent?.({ type: 'error', message: payload.message });
  } else if (eventName === 'final') {
    const ms =
      typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
        ? payload.durationMs
        : undefined;
    handlers.onFinal(ms);
    onEvent?.({ type: 'final', durationMs: ms });
  }
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
  } else if (
    tts.backend === 'local' &&
    caps &&
    !caps.ttsLoaded &&
    caps.loadedKind !== 'tts'
  ) {
    warning = 'Model will load on first synthesis';
  }

  const ttsLoaded = caps?.ttsLoaded === true || caps?.loadedKind === 'tts';

  return {
    backend: tts.backend,
    modelId,
    mode,
    runtimeReady,
    modelLoaded: ttsLoaded,
    warning,
    speakers: Array.isArray(caps?.speakers) ? caps.speakers : [],
    languages: Array.isArray(caps?.languages) ? caps.languages : [],
  };
}

/** @internal Test helper */
export function resetLocalTtsForTests() {
  loadedModelId = null;
}

/** @internal Test helper */
export { parseTtsSseBlock };
