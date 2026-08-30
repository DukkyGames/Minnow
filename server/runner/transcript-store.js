/**
 * In-memory transcript store — the server-side stand-in for `src/state/sessions.ts`.
 *
 * The runner never imports the session store. Renderer callers wrap `findChatById`;
 * the Node runner (and tests) pass this implementation.
 */

/**
 * @typedef {{ role: string, content?: unknown, [key: string]: unknown }} TranscriptMessage
 * @typedef {{ thinkingMode?: unknown, reasoningEffort?: unknown, [key: string]: unknown }} TranscriptMeta
 * @typedef {{ messages: TranscriptMessage[], meta: TranscriptMeta }} TranscriptRecord
 */

/**
 * @typedef {object} TranscriptStore
 * @property {(chatId: string) => TranscriptRecord | null} load
 * @property {(chatId: string, message: TranscriptMessage) => void} append
 * @property {(chatId: string, meta: TranscriptMeta) => void} setMeta
 */

/** @returns {TranscriptStore} */
export function createMemoryTranscriptStore() {
  /** @type {Map<string, TranscriptRecord>} */
  const chats = new Map();

  return {
    load(chatId) {
      const id = String(chatId ?? '').trim();
      if (!id) return null;
      const row = chats.get(id);
      if (!row) return null;
      return { messages: row.messages.slice(), meta: { ...row.meta } };
    },
    append(chatId, message) {
      const id = String(chatId ?? '').trim();
      if (!id) return;
      const row = chats.get(id) ?? { messages: [], meta: {} };
      row.messages.push(message);
      chats.set(id, row);
    },
    setMeta(chatId, meta) {
      const id = String(chatId ?? '').trim();
      if (!id) return;
      const row = chats.get(id) ?? { messages: [], meta: {} };
      row.meta = { ...row.meta, ...meta };
      chats.set(id, row);
    },
  };
}
