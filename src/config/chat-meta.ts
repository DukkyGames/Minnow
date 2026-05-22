/**
 * Main composer tool-loop limits in ~/.minnow/config.json (`chat` block).
 * Caps assistant → tool → assistant rounds per send (see `sendMessageWithTools`).
 */

import { detectConfigServer } from './storage-mode';

export interface ChatMeta {
  maxToolTurns: number;
}

const CHAT_META_STORAGE_KEY = 'minnow.chatMeta';

/** Default cap when unset (matches historical hardcoded loop limit). */
export const DEFAULT_CHAT_MAX_TOOL_TURNS = 8;

const DEFAULT_CHAT_META: ChatMeta = {
  maxToolTurns: DEFAULT_CHAT_MAX_TOOL_TURNS,
};

let cachedChat: ChatMeta | null = null;

/** Coerce a value to an integer max tool turn count in [1, 64]. */
export function clampMaxToolTurns(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CHAT_MAX_TOOL_TURNS;
  return Math.min(64, Math.max(1, Math.round(n)));
}

function parseChatBlock(raw: unknown): ChatMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CHAT_META };
  }
  const block = raw as Record<string, unknown>;
  return {
    maxToolTurns: clampMaxToolTurns(block.maxToolTurns),
  };
}

function readLocalChatMeta(): ChatMeta {
  try {
    const raw = localStorage.getItem(CHAT_META_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHAT_META };
    return parseChatBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHAT_META };
  }
}

function writeLocalChatMeta(config: ChatMeta): void {
  localStorage.setItem(CHAT_META_STORAGE_KEY, JSON.stringify(config));
}

async function fetchChatMetaFromServer(): Promise<ChatMeta> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalChatMeta();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseChatBlock(meta.chat);
}

/** Load main chat meta (cached until reset). */
export async function loadChatMeta(): Promise<ChatMeta> {
  if (cachedChat) return cachedChat;

  const serverUp = await detectConfigServer();
  cachedChat = serverUp ? await fetchChatMetaFromServer() : readLocalChatMeta();
  writeLocalChatMeta(cachedChat);
  return cachedChat;
}

/** Last loaded value or localStorage fallback before first async load. */
export function getChatMetaSync(): ChatMeta {
  return cachedChat ?? readLocalChatMeta();
}

/** Persist partial updates via PUT /api/config/meta and mirror to localStorage. */
export async function saveChatMeta(patch: Partial<ChatMeta>): Promise<void> {
  const current = await loadChatMeta();
  const next: ChatMeta = {
    maxToolTurns: clampMaxToolTurns(
      patch.maxToolTurns !== undefined ? patch.maxToolTurns : current.maxToolTurns,
    ),
  };
  cachedChat = next;
  writeLocalChatMeta(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat: next }),
  });
}

/** Clear cache (tests). */
export function resetChatMetaCache(): void {
  cachedChat = null;
}

/** Override cache for tests (no localStorage). */
export function setChatMetaForTests(config: ChatMeta): void {
  cachedChat = config;
}
