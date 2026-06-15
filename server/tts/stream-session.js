/**
 * Per-connection TTS stream session — forwards NDJSON text to the Python worker SSE endpoint.
 */

import { loadVoiceConfig } from '../voice/config.js';
import { createLocalTtsStream } from '../voice/local-tts.js';
import { formatServerMessage } from './tts-protocol.js';

/**
 * @typedef {import('ws').WebSocket} WsSocket
 */

/**
 * Whether streaming TTS is allowed for the current voice config.
 * @param {{ tts?: Record<string, unknown> }} voice
 */
export function checkTtsStreamEligibility(voice) {
  const tts = voice.tts ?? {};
  if (tts.enabled !== true || tts.backend !== 'local') {
    return { ok: false, error: 'Streaming TTS requires local backend' };
  }
  if (tts.streaming === false) {
    return { ok: false, error: 'Streaming TTS is disabled in settings' };
  }
  return { ok: true };
}

/**
 * Manage one browser WS ↔ worker stream bridge.
 */
export class TtsStreamSession {
  /** @param {WsSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.started = false;
    this.cancelled = false;
    this.readySent = false;
    this.sampleRate = 24000;
    /** @type {ReturnType<typeof createLocalTtsStream> | null} */
    this.workerStream = null;
    this.durationMs = undefined;
  }

  /**
   * Begin streaming after client sends start.
   * @param {{ text: string, voice?: string, speed?: number }} msg
   */
  async handleStart(msg) {
    if (this.started) return;
    this.started = true;

    const voice = await loadVoiceConfig();
    const eligibility = checkTtsStreamEligibility(voice);
    if (!eligibility.ok) {
      this.sendError(eligibility.error);
      this.closeWs();
      return;
    }

    const tts = voice.tts;
    /** @type {Record<string, unknown>} */
    const localConfig = { ...tts.local };
    if (msg.voice) {
      localConfig.customVoice = {
        ...(typeof localConfig.customVoice === 'object' && localConfig.customVoice
          ? localConfig.customVoice
          : {}),
        speaker: msg.voice,
      };
    }

    try {
      this.workerStream = createLocalTtsStream({
        localConfig,
        onEvent: (event) => this.relayWorkerEvent(event),
      });
      await this.workerStream.open();
      this.workerStream.writeText(msg.text);
      await this.workerStream.finish();
      if (!this.cancelled) {
        this.sendFinal(this.durationMs);
      }
    } catch (err) {
      if (!this.cancelled) {
        const message = err instanceof Error ? err.message : String(err);
        this.sendError(message);
      }
    } finally {
      if (!this.cancelled) {
        this.closeWs();
      }
    }
  }

  /** Client requested cancel — abort worker stream. */
  async handleCancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.workerStream) {
      try {
        await this.workerStream.abort();
      } catch {
        /* ignore */
      }
      this.workerStream = null;
    }
    this.closeWs();
  }

  /** Clean up when the browser disconnects. */
  async dispose() {
    if (this.workerStream) {
      try {
        await this.workerStream.abort();
      } catch {
        /* ignore */
      }
      this.workerStream = null;
    }
  }

  /**
   * @param {import('../voice/local-tts.js').TtsStreamWorkerEvent} event
   */
  relayWorkerEvent(event) {
    if (this.cancelled) return;

    if (event.type === 'chunk') {
      if (!this.readySent) {
        this.sampleRate = event.sampleRate;
        this.sendReady(event.sampleRate);
        this.readySent = true;
      }
      this.sendBinary(event.pcm);
      return;
    }
    if (event.type === 'final') {
      this.durationMs = event.durationMs;
      return;
    }
    if (event.type === 'error') {
      this.sendError(event.message);
      this.cancelled = true;
    }
  }

  /** @param {number} sampleRate */
  sendReady(sampleRate) {
    this.send(formatServerMessage('ready', { sampleRate }));
  }

  /** @param {number | undefined} durationMs */
  sendFinal(durationMs) {
    const fields = durationMs != null ? { durationMs } : {};
    this.send(formatServerMessage('final', fields));
  }

  /** @param {string} message */
  sendError(message) {
    this.send(formatServerMessage('error', { message }));
  }

  /** @param {Buffer} pcm */
  sendBinary(pcm) {
    if (this.ws.readyState === this.ws.OPEN && pcm.length) {
      this.ws.send(pcm, { binary: true });
    }
  }

  /** @param {string} payload */
  send(payload) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(payload);
    }
  }

  closeWs() {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
    }
  }
}
