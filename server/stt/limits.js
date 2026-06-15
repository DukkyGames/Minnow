/**
 * STT upload size and MIME allowlist (ported from Odysseus upload_limits.py).
 */

/** Default max audio upload size: 25 MB. */
export const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Default max recording duration in seconds. */
export const DEFAULT_MAX_DURATION_SECONDS = 300;

/** MIME types accepted for transcription uploads. */
export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
]);

/**
 * Human-readable byte limit for error messages.
 * @param {number} limit
 */
export function formatByteLimit(limit) {
  if (limit % (1024 * 1024) === 0) {
    return `${limit / (1024 * 1024)} MB`;
  }
  if (limit % 1024 === 0) {
    return `${limit / 1024} KB`;
  }
  return `${limit} bytes`;
}

/**
 * Normalize a MIME type to the base type without parameters.
 * @param {string} mime
 */
export function normalizeMimeType(mime) {
  const trimmed = String(mime || '')
    .trim()
    .toLowerCase();
  const base = trimmed.split(';')[0]?.trim() ?? '';
  return base;
}

/**
 * Check whether a MIME type is allowed for STT uploads.
 * @param {string} mime
 */
export function isAllowedAudioMime(mime) {
  const base = normalizeMimeType(mime);
  if (!base) return false;
  if (ALLOWED_AUDIO_MIME_TYPES.has(base)) return true;
  // Accept codec-qualified webm variants such as audio/webm;codecs=opus.
  if (base.startsWith('audio/webm')) return true;
  return false;
}

/**
 * Resolve upload limits from voice config.
 * @param {{ limits?: { maxAudioBytes?: number, maxDurationSeconds?: number } }} voiceConfig
 */
export function resolveSttLimits(voiceConfig = {}) {
  const limits = voiceConfig.limits && typeof voiceConfig.limits === 'object'
    ? voiceConfig.limits
    : {};
  const maxAudioBytes =
    typeof limits.maxAudioBytes === 'number' && Number.isFinite(limits.maxAudioBytes)
      ? Math.max(1024, Math.round(limits.maxAudioBytes))
      : DEFAULT_MAX_AUDIO_BYTES;
  const maxDurationSeconds =
    typeof limits.maxDurationSeconds === 'number' &&
    Number.isFinite(limits.maxDurationSeconds)
      ? Math.max(1, Math.round(limits.maxDurationSeconds))
      : DEFAULT_MAX_DURATION_SECONDS;
  return { maxAudioBytes, maxDurationSeconds };
}
