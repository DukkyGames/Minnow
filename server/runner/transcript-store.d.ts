/** One API/transcript row stored by {@link TranscriptStore}. */
export interface TranscriptMessage {
  role: string;
  content?: unknown;
}

/** Parent-chat fields the runner reads (thinking / reasoning). */
export interface TranscriptMeta {
  thinkingMode?: unknown;
  reasoningEffort?: unknown;
}

export interface TranscriptRecord {
  messages: TranscriptMessage[];
  meta: TranscriptMeta;
}

/**
 * Injected session seam. Removes `src/state/sessions.ts` from the runner.
 * `load` is synchronous so the existing turn loop does not become async at read.
 */
export interface TranscriptStore {
  load(chatId: string): TranscriptRecord | null;
  append(chatId: string, message: TranscriptMessage): void;
  setMeta(chatId: string, meta: TranscriptMeta): void;
}

/** Empty in-memory store for Node / tests — no session store required. */
export function createMemoryTranscriptStore(): TranscriptStore;
