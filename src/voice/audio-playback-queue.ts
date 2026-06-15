/**
 * Web Audio scheduler for streaming Int16 PCM — Hann crossfade between chunks.
 */

const DEFAULT_OVERLAP_MS = 10;
const MIN_SCHEDULE_AHEAD_SEC = 0.05;

/** Convert little-endian Int16 mono PCM to normalized float32 [-1, 1]. */
export function int16LeToFloat32(pcm: ArrayBuffer): Float32Array {
  const view = new DataView(pcm);
  const count = Math.floor(pcm.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const sample = view.getInt16(i * 2, true);
    out[i] = sample / (sample < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

/** Hann window of the given length (inclusive endpoints). */
export function hannWindow(length: number): Float32Array {
  const win = new Float32Array(length);
  if (length <= 0) return win;
  if (length === 1) {
    win[0] = 1;
    return win;
  }
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return win;
}

/**
 * Crossfade the tail of `previous` with the head of `next` over `overlap` samples.
 * Returns one contiguous buffer ready to schedule.
 */
export function crossfadePcmChunks(
  previous: Float32Array,
  next: Float32Array,
  overlap: number,
): Float32Array {
  const o = Math.min(overlap, previous.length, next.length);
  if (o <= 0) {
    const merged = new Float32Array(previous.length + next.length);
    merged.set(previous, 0);
    merged.set(next, previous.length);
    return merged;
  }

  const hann = hannWindow(o);
  const merged = new Float32Array(previous.length + next.length - o);
  const preBody = previous.length - o;
  merged.set(previous.subarray(0, preBody), 0);

  for (let i = 0; i < o; i++) {
    const fadeOut = 1 - (hann[i] ?? 0);
    const fadeIn = hann[i] ?? 0;
    merged[preBody + i] =
      (previous[preBody + i] ?? 0) * fadeOut + (next[i] ?? 0) * fadeIn;
  }

  merged.set(next.subarray(o), preBody + o);
  return merged;
}

/** Linear resample float PCM when context rate differs from stream rate. */
export function resampleFloat32(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const outLen = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * fromRate) / toRate;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[Math.min(idx + 1, samples.length - 1)] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Overlap sample count for a sample rate and millisecond window. */
export function overlapSamplesForRate(sampleRate: number, overlapMs = DEFAULT_OVERLAP_MS): number {
  return Math.max(1, Math.round((sampleRate * overlapMs) / 1000));
}

export interface AudioPlaybackQueueOptions {
  outputDeviceId?: string;
  overlapMs?: number;
}

/**
 * Gapless PCM playback queue — schedules AudioBuffer chunks with Hann crossfades.
 */
export class AudioPlaybackQueue {
  private ctx: AudioContext | null = null;
  private sampleRate = 24_000;
  private overlapMs: number;
  private overlapSamples = overlapSamplesForRate(24_000);
  private nextStartTime = 0;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private stopped = false;
  private pendingSources = 0;
  private drainResolvers: Array<() => void> = [];
  private carry: Float32Array | null = null;
  private outputDeviceId: string;

  constructor(options: AudioPlaybackQueueOptions = {}) {
    this.outputDeviceId = options.outputDeviceId ?? '';
    this.overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;
    this.overlapSamples = overlapSamplesForRate(this.sampleRate, this.overlapMs);
  }

  /** Update sample rate after server ready (recomputes overlap length). */
  setSampleRate(sampleRate: number): void {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
    this.sampleRate = sampleRate;
    this.overlapSamples = overlapSamplesForRate(sampleRate, this.overlapMs);
    if (this.ctx && this.ctx.sampleRate !== sampleRate) {
      void this.ctx.close();
      this.ctx = null;
      this.nextStartTime = 0;
    }
  }

  /** Queue one Int16 PCM chunk for playback. */
  async enqueue(pcm: ArrayBuffer): Promise<void> {
    if (this.stopped || pcm.byteLength < 2) return;

    const ctx = await this.ensureContext();
    let samples = int16LeToFloat32(pcm);

    if (this.carry) {
      samples = crossfadePcmChunks(this.carry, samples, this.overlapSamples);
      this.carry = null;
    }

    if (samples.length <= this.overlapSamples) {
      this.carry = samples;
      return;
    }

    this.carry = samples.slice(samples.length - this.overlapSamples);
    const playable = samples.slice(0, samples.length - this.overlapSamples);
    this.scheduleBuffer(ctx, playable);
  }

  /** Stop immediately and release audio resources. */
  stop(): void {
    this.stopped = true;
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    }
    this.scheduledSources = [];
    this.carry = null;
    this.pendingSources = 0;
    this.nextStartTime = 0;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.resolveDrainWaiters();
  }

  /** Wait until all scheduled audio (including carry tail) has finished. */
  async drain(): Promise<void> {
    if (this.stopped) return;
    await this.flushCarry();
    if (this.pendingSources === 0) return;
    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.stopped) {
      throw new Error('Playback queue stopped');
    }
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      } catch {
        this.ctx = new AudioContext();
      }
      await this.applyOutputDevice(this.ctx);
      this.nextStartTime = this.ctx.currentTime + MIN_SCHEDULE_AHEAD_SEC;
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  private async applyOutputDevice(ctx: AudioContext): Promise<void> {
    if (!this.outputDeviceId) return;
    const sinkable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof sinkable.setSinkId !== 'function') return;
    try {
      await sinkable.setSinkId(this.outputDeviceId);
    } catch {
      /* ignore sink routing errors */
    }
  }

  private scheduleBuffer(ctx: AudioContext, samples: Float32Array): void {
    if (this.stopped || samples.length === 0) return;

    const playable =
      ctx.sampleRate === this.sampleRate
        ? samples
        : resampleFloat32(samples, this.sampleRate, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, playable.length, ctx.sampleRate);
    buffer.getChannelData(0).set(playable);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (this.nextStartTime < now + MIN_SCHEDULE_AHEAD_SEC) {
      this.nextStartTime = now + MIN_SCHEDULE_AHEAD_SEC;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.pendingSources += 1;

    source.onended = () => {
      this.pendingSources = Math.max(0, this.pendingSources - 1);
      this.tryResolveDrain();
    };

    this.scheduledSources.push(source);
  }

  private async flushCarry(): Promise<void> {
    if (!this.carry || this.carry.length === 0 || this.stopped) return;
    const ctx = await this.ensureContext();
    this.scheduleBuffer(ctx, this.carry);
    this.carry = null;
  }

  private tryResolveDrain(): void {
    if (this.pendingSources === 0 && !this.carry) {
      this.resolveDrainWaiters();
    }
  }

  private resolveDrainWaiters(): void {
    const waiters = this.drainResolvers;
    this.drainResolvers = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}
