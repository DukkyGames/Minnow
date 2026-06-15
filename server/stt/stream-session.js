/**
 * Per-connection STT stream session — forwards PCM to the Python worker SSE endpoint.
 */

import { loadVoiceConfig } from '../voice/config.js';
import { createLocalSttStream } from '../voice/local-stt.js';
import { resolveSttLimits } from './limits.js';
import { formatServerMessage } from './stt-protocol.js';

/**
 * @typedef {import('ws').WebSocket} WsSocket
 */

/**
 * Manage one browser WS ↔ worker stream bridge.
 */
export class SttStreamSession {
  /** @param {WsSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.started = false;
    this.stopped = false;
    /** @type {ReturnType<typeof createLocalSttStream> | null} */
    this.workerStream = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.durationTimer = null;
    this.startedAt = 0;
    this.maxDurationSeconds = 300;
    this.accumulatedText = '';
  }

  /** Begin streaming after client sends start. */
  async handleStart() {
    if (this.started) return;
    this.started = true;

    const voice = await loadVoiceConfig();
    const stt = voice.stt;
    if (!stt.enabled || stt.backend !== 'local') {
      this.sendError('Streaming STT requires local Whisper backend');
      this.closeWs();
      return;
    }

    const streamingEnabled = stt.local?.streamingEnabled !== false;
    if (!streamingEnabled) {
      this.sendError('Streaming STT is disabled in settings');
      this.closeWs();
      return;
    }

    const { maxDurationSeconds } = resolveSttLimits(voice);
    this.maxDurationSeconds = maxDurationSeconds;
    this.startedAt = Date.now();

    try {
      this.workerStream = createLocalSttStream({
        localConfig: stt.local,
        onEvent: (event) => this.relayWorkerEvent(event),
      });
      await this.workerStream.open();
      this.send(formatServerMessage('ready'));
      this.armDurationTimer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(message);
      this.closeWs();
    }
  }

  /** Forward binary PCM from the browser to the worker stream. */
  handleAudio(data) {
    if (!this.started || this.stopped || !this.workerStream) return;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!buffer.length) return;
    this.workerStream.writePcm(buffer);
  }

  /** Client requested stop — flush worker and send final. */
  async handleStop() {
    if (this.stopped) return;
    this.stopped = true;
    this.clearDurationTimer();
    if (!this.workerStream) {
      this.sendFinal('');
      this.closeWs();
      return;
    }
    try {
      const text = await this.workerStream.close();
      this.accumulatedText = text.trim() || this.accumulatedText;
      this.sendFinal(this.accumulatedText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(message);
    } finally {
      this.closeWs();
    }
  }

  /** Clean up when the browser disconnects. */
  async dispose() {
    this.clearDurationTimer();
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
   * @param {import('../voice/local-stt.js').SttStreamWorkerEvent} event
   */
  relayWorkerEvent(event) {
    if (event.type === 'segment') {
      this.accumulatedText = joinTranscript(this.accumulatedText, event.text);
      this.send(formatServerMessage('segment', { text: event.text }));
      return;
    }
    if (event.type === 'partial') {
      this.send(formatServerMessage('partial', { text: event.text }));
      return;
    }
    if (event.type === 'error') {
      this.sendError(event.message);
    }
  }

  sendFinal(text) {
    this.send(formatServerMessage('final', { text }));
  }

  sendError(message) {
    this.send(formatServerMessage('error', { message }));
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

  armDurationTimer() {
    this.clearDurationTimer();
    this.durationTimer = setTimeout(() => {
      if (this.stopped) return;
      this.sendError(`Recording stopped at ${this.maxDurationSeconds}s limit`);
      void this.handleStop();
    }, this.maxDurationSeconds * 1000);
  }

  clearDurationTimer() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }
}

/**
 * @param {string} left
 * @param {string} right
 */
function joinTranscript(left, right) {
  const trimmed = String(right || '').trim();
  if (!trimmed) return left;
  if (!left) return trimmed;
  const spacer = !left.endsWith(' ') && !trimmed.startsWith(' ') ? ' ' : '';
  return `${left}${spacer}${trimmed}`;
}

/** @internal Test helper */
export { joinTranscript };
