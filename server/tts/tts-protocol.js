/**
 * JSON WebSocket message helpers for TTS streaming sessions.
 * Binary frames carry little-endian Int16 PCM mono samples.
 */

export const MAX_TTS_WS_MESSAGE_CHARS = 64 * 1024;

/**
 * Parse a client control message (JSON text frames).
 * @param {unknown} raw
 * @returns {{ type: 'start', text: string, voice?: string, speed?: number } | { type: 'cancel' } | { type: 'ping' } | null}
 */
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_TTS_WS_MESSAGE_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;

  if (msg.type === 'start') {
    const text = typeof msg.text === 'string' ? msg.text : '';
    if (!text.trim()) return null;
    const result = { type: 'start', text };
    if (typeof msg.voice === 'string' && msg.voice.trim()) {
      result.voice = msg.voice.trim();
    }
    if (typeof msg.speed === 'number' && Number.isFinite(msg.speed)) {
      result.speed = msg.speed;
    }
    return result;
  }
  if (msg.type === 'cancel') return { type: 'cancel' };
  if (msg.type === 'ping') return { type: 'ping' };
  return null;
}

/**
 * Format a server → client JSON event.
 * @param {'ready' | 'final' | 'error'} type
 * @param {Record<string, unknown>} [fields]
 */
export function formatServerMessage(type, fields = {}) {
  const payload = { type, ...fields };
  const text = JSON.stringify(payload);
  if (text.length > MAX_TTS_WS_MESSAGE_CHARS) {
    return JSON.stringify({
      type: 'error',
      message: 'Server message too large',
    });
  }
  return text;
}

/**
 * Parse a server event from JSON (client-side helper mirror).
 * @param {unknown} raw
 */
export function parseServerMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_TTS_WS_MESSAGE_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;

  if (msg.type === 'ready' && typeof msg.sampleRate === 'number') {
    return { type: 'ready', sampleRate: msg.sampleRate };
  }
  if (msg.type === 'final') {
    const durationMs =
      typeof msg.durationMs === 'number' && Number.isFinite(msg.durationMs)
        ? msg.durationMs
        : undefined;
    return durationMs != null ? { type: 'final', durationMs } : { type: 'final' };
  }
  if (msg.type === 'error' && typeof msg.message === 'string') {
    return { type: 'error', message: msg.message };
  }
  return null;
}
