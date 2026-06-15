/**
 * Client-side voice-activity helper — auto-stop recording after a pause in speech.
 */

/** Average frequency energy on the 0–255 scale used by composer mic UI. */
export function readAudioLevel(analyser: AnalyserNode): number {
  const samples = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i]!;
  }
  return sum / samples.length;
}

export const DEFAULT_SPEECH_THRESHOLD = 5;

export interface MicAnalyserHandle {
  analyser: AnalyserNode;
  disconnect: () => void;
}

/** Tap a live mic stream for level / silence monitoring. */
export function connectMicAnalyser(stream: MediaStream): MicAnalyserHandle {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.72;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  return {
    analyser,
    disconnect: () => {
      void audioContext.close().catch(() => undefined);
    },
  };
}

export interface SilenceWatchOptions {
  /** Milliseconds of silence after speech before firing (0 = disabled). */
  silenceTimeoutMs: number;
  /** Require at least this much speech before silence can end the take. */
  minSpeechMs?: number;
  levelThreshold?: number;
  onSpeech?: () => void;
  onSilenceTimeout: () => void;
  /** Optional per-frame callback for UI level meters. */
  onLevel?: (level: number, speaking: boolean) => void;
}

/**
 * Poll mic energy each animation frame; call `onSilenceTimeout` after sustained silence.
 * Returns a disposer — call it when recording ends.
 */
export function watchSilence(
  analyser: AnalyserNode,
  options: SilenceWatchOptions,
): () => void {
  let raf = 0;
  let lastSpeechAt = 0;
  let speechStartedAt = 0;
  let hasSpeech = false;
  const threshold = options.levelThreshold ?? DEFAULT_SPEECH_THRESHOLD;
  const minSpeech = options.minSpeechMs ?? 200;

  const stop = (): void => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const tick = (): void => {
    const average = readAudioLevel(analyser);
    const speaking = average > threshold;
    const level = Math.min(1, average / 42);
    options.onLevel?.(level, speaking);

    const now = performance.now();
    if (speaking) {
      if (!hasSpeech) {
        speechStartedAt = now;
      }
      hasSpeech = true;
      lastSpeechAt = now;
      options.onSpeech?.();
    } else if (
      hasSpeech &&
      options.silenceTimeoutMs > 0 &&
      now - lastSpeechAt >= options.silenceTimeoutMs &&
      now - speechStartedAt >= minSpeech
    ) {
      stop();
      options.onSilenceTimeout();
      return;
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return stop;
}
