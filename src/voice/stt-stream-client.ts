/**
 * Browser WebSocket client for live local STT — 16 kHz mono Int16 PCM over WS.
 */

import { withSessionToken } from '../api/session-token.ts';

const MAX_STT_WS_MESSAGE_CHARS = 64 * 1024;

/** Parse a server STT WebSocket JSON event. */
function parseServerMessage(raw: string): SttStreamServerEvent | null {
  if (raw.length > MAX_STT_WS_MESSAGE_CHARS) return null;
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    if (!msg || typeof msg.type !== 'string') return null;
    if (msg.type === 'ready') return { type: 'ready' };
    if (msg.type === 'segment' && typeof msg.text === 'string') {
      return { type: 'segment', text: msg.text };
    }
    if (msg.type === 'partial' && typeof msg.text === 'string') {
      return { type: 'partial', text: msg.text };
    }
    if (msg.type === 'final' && typeof msg.text === 'string') {
      return { type: 'final', text: msg.text };
    }
    if (msg.type === 'error' && typeof msg.message === 'string') {
      return { type: 'error', message: msg.message };
    }
    return null;
  } catch {
    return null;
  }
}

export const STT_SAMPLE_RATE = 16_000;

export type SttStreamServerEvent =
  | { type: 'ready' }
  | { type: 'segment'; text: string }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string };

export interface SttStreamClientCallbacks {
  onReady?: () => void;
  onPartial?: (text: string) => void;
  onSegment?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
}

export interface SttStreamClientOptions extends SttStreamClientCallbacks {
  inputDeviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

/** Build same-origin WebSocket URL for STT streaming. */
export function buildSttWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return withSessionToken(`${proto}//${window.location.host}/api/stt/ws`);
}

/** Convert float32 [-1,1] samples to little-endian Int16 PCM bytes. */
export function float32ToInt16Pcm(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/**
 * Live STT session: opens WS, captures mic PCM, forwards binary audio frames.
 */
export class SttStreamClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private callbacks: SttStreamClientCallbacks;
  private inputDeviceId: string;
  private audioConstraints: MediaTrackConstraints;
  private finalPromise: Promise<string> | null = null;
  private resolveFinal: ((text: string) => void) | null = null;
  private rejectFinal: ((err: Error) => void) | null = null;
  private accumulatedFinal = '';

  constructor(options: SttStreamClientOptions = {}) {
    this.callbacks = options;
    this.inputDeviceId = options.inputDeviceId ?? '';
    this.audioConstraints = {
      echoCancellation: options.echoCancellation ?? true,
      noiseSuppression: options.noiseSuppression ?? true,
      autoGainControl: options.autoGainControl ?? true,
    };
  }

  /** Open WS + mic capture; resolves when server sends ready. */
  async start(): Promise<void> {
    if (this.ws) return;

    this.accumulatedFinal = '';
    this.finalPromise = new Promise<string>((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(buildSttWsUrl());
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start' }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const parsed = parseServerMessage(event.data);
          if (!parsed) return;
          this.handleServerEvent(parsed, resolve, reject);
          return;
        }
        /* Binary from server is not expected in v1 */
      };

      ws.onerror = () => {
        reject(new Error('STT WebSocket connection failed'));
      };

      ws.onclose = () => {
        if (this.resolveFinal) {
          this.resolveFinal(this.accumulatedFinal);
          this.clearFinalHandlers();
        }
      };
    });

    await this.startAudioCapture();
  }

  /** Stop capture and request final transcription; returns reconciled text. */
  async stop(): Promise<string> {
    this.stopAudioCapture();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }
    const text = (await this.finalPromise) ?? this.accumulatedFinal;
    this.close();
    return text;
  }

  /** Tear down WS and audio graph without waiting for final. */
  close(): void {
    this.stopAudioCapture();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.clearFinalHandlers();
  }

  /** Underlying mic stream (for silence detector / level UI). */
  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  private handleServerEvent(
    event: SttStreamServerEvent,
    onReady: () => void,
    onStartError: (err: Error) => void,
  ): void {
    switch (event.type) {
      case 'ready':
        this.callbacks.onReady?.();
        onReady();
        break;
      case 'segment':
        this.accumulatedFinal = this.joinText(this.accumulatedFinal, event.text);
        this.callbacks.onSegment?.(event.text);
        break;
      case 'partial':
        this.callbacks.onPartial?.(event.text);
        break;
      case 'final':
        this.accumulatedFinal = event.text.trim() || this.accumulatedFinal;
        this.callbacks.onFinal?.(this.accumulatedFinal);
        if (this.resolveFinal) {
          this.resolveFinal(this.accumulatedFinal);
          this.clearFinalHandlers();
        }
        break;
      case 'error':
        this.callbacks.onError?.(event.message);
        onStartError(new Error(event.message));
        if (this.rejectFinal) {
          this.rejectFinal(new Error(event.message));
          this.clearFinalHandlers();
        }
        break;
      default:
        break;
    }
  }

  private joinText(left: string, right: string): string {
    const trimmed = right.trim();
    if (!trimmed) return left;
    if (!left) return trimmed;
    const spacer = !left.endsWith(' ') && !trimmed.startsWith(' ') ? ' ' : '';
    return `${left}${spacer}${trimmed}`;
  }

  private clearFinalHandlers(): void {
    this.resolveFinal = null;
    this.rejectFinal = null;
    this.finalPromise = null;
  }

  private async startAudioCapture(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone is not supported in this browser');
    }

    const constraints: MediaTrackConstraints = { ...this.audioConstraints };
    if (this.inputDeviceId) {
      constraints.deviceId = { exact: this.inputDeviceId };
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    this.audioContext = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // ScriptProcessor fallback — widely supported; buffer 4096 frames at 16 kHz.
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = float32ToInt16Pcm(input);
      this.ws.send(pcm);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  private stopAudioCapture(): void {
    this.processor?.disconnect();
    this.processor = null;
    this.source?.disconnect();
    this.source = null;
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}
