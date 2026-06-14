/**
 * Voice I/O settings persisted in ~/.minnow/config.json (`voice` block).
 */

import { detectConfigServer } from './storage-mode';

export interface VoiceSttConfig {
  enabled: boolean;
  providerId: string;
  model: string;
  language: string;
}

export interface VoiceTtsConfig {
  enabled: boolean;
  providerId: string;
  model: string;
  voice: string;
  speed: number;
  format: string;
}

export interface VoiceLimitsConfig {
  maxAudioBytes: number;
  maxDurationSeconds: number;
}

export interface VoiceConfig {
  stt: VoiceSttConfig;
  tts: VoiceTtsConfig;
  limits: VoiceLimitsConfig;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  stt: {
    enabled: true,
    providerId: '',
    model: 'whisper-1',
    language: 'en',
  },
  tts: {
    enabled: true,
    providerId: '',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1,
    format: 'mp3',
  },
  limits: {
    maxAudioBytes: 25 * 1024 * 1024,
    maxDurationSeconds: 300,
  },
};

const VOICE_META_STORAGE_KEY = 'minnow.voiceMeta';

let cachedVoice: VoiceConfig | null = null;

function parseVoiceBlock(raw: unknown): VoiceConfig {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_VOICE_CONFIG);
  }
  const block = raw as Record<string, unknown>;
  const stt =
    block.stt && typeof block.stt === 'object'
      ? (block.stt as Record<string, unknown>)
      : {};
  const tts =
    block.tts && typeof block.tts === 'object'
      ? (block.tts as Record<string, unknown>)
      : {};
  const limits =
    block.limits && typeof block.limits === 'object'
      ? (block.limits as Record<string, unknown>)
      : {};
  return {
    stt: {
      enabled: stt.enabled !== false,
      providerId: typeof stt.providerId === 'string' ? stt.providerId : '',
      model: typeof stt.model === 'string' && stt.model ? stt.model : 'whisper-1',
      language:
        typeof stt.language === 'string' && stt.language ? stt.language : 'en',
    },
    tts: {
      enabled: tts.enabled !== false,
      providerId: typeof tts.providerId === 'string' ? tts.providerId : '',
      model: typeof tts.model === 'string' && tts.model ? tts.model : 'tts-1',
      voice: typeof tts.voice === 'string' && tts.voice ? tts.voice : 'alloy',
      speed:
        typeof tts.speed === 'number' && Number.isFinite(tts.speed)
          ? Math.min(4, Math.max(0.25, tts.speed))
          : 1,
      format:
        typeof tts.format === 'string' && tts.format ? tts.format : 'mp3',
    },
    limits: {
      maxAudioBytes:
        typeof limits.maxAudioBytes === 'number' &&
        Number.isFinite(limits.maxAudioBytes)
          ? limits.maxAudioBytes
          : DEFAULT_VOICE_CONFIG.limits.maxAudioBytes,
      maxDurationSeconds:
        typeof limits.maxDurationSeconds === 'number' &&
        Number.isFinite(limits.maxDurationSeconds)
          ? limits.maxDurationSeconds
          : DEFAULT_VOICE_CONFIG.limits.maxDurationSeconds,
    },
  };
}

function readLocalVoiceMeta(): VoiceConfig {
  try {
    const raw = localStorage.getItem(VOICE_META_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_VOICE_CONFIG);
    return parseVoiceBlock(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_VOICE_CONFIG);
  }
}

function writeLocalVoiceMeta(config: VoiceConfig): void {
  localStorage.setItem(VOICE_META_STORAGE_KEY, JSON.stringify(config));
}

async function fetchVoiceFromServer(): Promise<VoiceConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalVoiceMeta();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseVoiceBlock(meta.voice);
}

/** Load voice config (cached until reset). */
export async function loadVoiceMeta(): Promise<VoiceConfig> {
  if (cachedVoice) return cachedVoice;
  const serverUp = await detectConfigServer();
  cachedVoice = serverUp ? await fetchVoiceFromServer() : readLocalVoiceMeta();
  writeLocalVoiceMeta(cachedVoice);
  return cachedVoice;
}

export function getVoiceMetaSync(): VoiceConfig {
  return cachedVoice ?? readLocalVoiceMeta();
}

export function resetVoiceMetaCache(): void {
  cachedVoice = null;
}

/** Persist partial voice config via PUT /api/config/meta. */
export async function saveVoiceMeta(
  patch: Partial<VoiceConfig> & {
    stt?: Partial<VoiceSttConfig>;
    tts?: Partial<VoiceTtsConfig>;
    limits?: Partial<VoiceLimitsConfig>;
  },
): Promise<VoiceConfig | null> {
  const serverUp = await detectConfigServer();
  if (!serverUp) return null;

  const current = await loadVoiceMeta();
  const merged: VoiceConfig = {
    stt: { ...current.stt, ...patch.stt },
    tts: { ...current.tts, ...patch.tts },
    limits: { ...current.limits, ...patch.limits },
  };
  cachedVoice = merged;
  writeLocalVoiceMeta(merged);

  const res = await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: merged }),
  });
  if (!res.ok) return null;
  return merged;
}
