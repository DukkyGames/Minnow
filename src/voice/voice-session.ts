/**
 * Voice session contract for future turn-taking voice chat.
 * Hooks only — full duplex / push-to-talk wiring is deferred.
 */

import { SttStreamClient } from './stt-stream-client.ts';
import { TtsStreamClient } from './tts-stream-client.ts';

/** High-level voice session state (half-duplex turn-taking). */
export type VoiceSessionState = 'idle' | 'listening' | 'speaking';

/**
 * Coordinates STT capture and TTS playback for a single voice-chat turn.
 * Implementations must not run mic capture and speaker output concurrently (v1).
 */
export interface VoiceSession {
  stt: SttStreamClient;
  tts: TtsStreamClient;
  state: VoiceSessionState;
  /** Begin microphone capture and live transcription. */
  startListening(): Promise<void>;
  /** Synthesize and play the given plain text. */
  speak(text: string): Promise<void>;
  /** Stop capture, playback, and tear down open sockets. */
  stop(): void;
}

/**
 * Minimal stub for tests and future chat integration.
 * Does not wire mic or speakers — callers supply real clients later.
 */
export class VoiceSessionStub implements VoiceSession {
  stt: SttStreamClient;
  tts: TtsStreamClient;
  state: VoiceSessionState = 'idle';

  constructor(options: { stt?: SttStreamClient; tts?: TtsStreamClient } = {}) {
    this.stt = options.stt ?? new SttStreamClient();
    this.tts = options.tts ?? new TtsStreamClient();
  }

  async startListening(): Promise<void> {
    if (this.state === 'speaking') {
      this.tts.cancel();
    }
    this.state = 'listening';
    await this.stt.start();
  }

  async speak(text: string): Promise<void> {
    if (this.state === 'listening') {
      await this.stt.stop();
    }
    this.state = 'speaking';
    await this.tts.start(text.trim());
  }

  stop(): void {
    this.stt.close();
    this.tts.cancel();
    this.state = 'idle';
  }
}
