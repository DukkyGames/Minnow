/**
 * JSON WebSocket message helpers for PTY sessions.
 */

export const MAX_WS_MESSAGE_CHARS = 256 * 1024;

/**
 * @param {unknown} raw
 * @returns {{ type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number } | null}
 */
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_WS_MESSAGE_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;

  if (msg.type === 'input' && typeof msg.data === 'string') {
    if (msg.data.length > MAX_WS_MESSAGE_CHARS) return null;
    return { type: 'input', data: msg.data };
  }

  if (msg.type === 'resize') {
    const cols = Number(msg.cols);
    const rows = Number(msg.rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
    if (cols < 2 || cols > 500 || rows < 2 || rows > 200) return null;
    return { type: 'resize', cols: Math.floor(cols), rows: Math.floor(rows) };
  }

  return null;
}

/**
 * @param {'output' | 'exit' | 'meta'} type
 * @param {Record<string, unknown>} fields
 */
export function formatServerMessage(type, fields) {
  const payload = { type, ...fields };
  const text = JSON.stringify(payload);
  if (text.length > MAX_WS_MESSAGE_CHARS) {
    return JSON.stringify({ type: 'output', data: text.slice(0, MAX_WS_MESSAGE_CHARS) });
  }
  return text;
}
