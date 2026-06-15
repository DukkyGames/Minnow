/**
 * JSON WebSocket message helpers for STT streaming sessions.
 */

export const MAX_STT_WS_MESSAGE_CHARS = 64 * 1024;

/**
 * Parse a client control message (JSON text frames).
 * @param {unknown} raw
 * @returns {{ type: 'start' } | { type: 'stop' } | { type: 'ping' } | null}
 */
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_STT_WS_MESSAGE_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;

  if (msg.type === 'start') return { type: 'start' };
  if (msg.type === 'stop') return { type: 'stop' };
  if (msg.type === 'ping') return { type: 'ping' };
  return null;
}

/**
 * Format a server → client JSON event.
 * @param {'ready' | 'segment' | 'partial' | 'final' | 'error'} type
 * @param {Record<string, unknown>} [fields]
 */
export function formatServerMessage(type, fields = {}) {
  const payload = { type, ...fields };
  const text = JSON.stringify(payload);
  if (text.length > MAX_STT_WS_MESSAGE_CHARS) {
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
  if (typeof raw !== 'string' || raw.length > MAX_STT_WS_MESSAGE_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;

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
}
