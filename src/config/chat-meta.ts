/**
 * Main composer settings in ~/.minnow/config.json (`chat` block).
 * Tool-loop caps and server-side generation upstream timeouts.
 */

import { detectConfigServer } from './storage-mode';

export interface ChatMeta {
  maxToolTurns: number;
  /** Abort when no upstream SSE bytes arrive for this long (resets per chunk). */
  generationIdleTimeoutMs: number;
  /** Wall-clock cap for a single upstream generation. */
  generationMaxDurationMs: number;
}

const CHAT_META_STORAGE_KEY = 'minnow.chatMeta';

/** Default cap when unset (matches historical hardcoded loop limit). */
export const DEFAULT_CHAT_MAX_TOOL_TURNS = 8;

export const DEFAULT_GENERATION_IDLE_TIMEOUT_MS = 25 * 60_000;
export const DEFAULT_GENERATION_MAX_DURATION_MS = 60 * 60_000;

const MIN_GENERATION_IDLE_TIMEOUT_MS = 30_000;
const MAX_GENERATION_IDLE_TIMEOUT_MS = 30 * 60_000;
const MIN_GENERATION_MAX_DURATION_MS = 60_000;
const MAX_GENERATION_MAX_DURATION_MS = 4 * 60 * 60_000;

const DEFAULT_CHAT_META: ChatMeta = {
  maxToolTurns: DEFAULT_CHAT_MAX_TOOL_TURNS,
  generationIdleTimeoutMs: DEFAULT_GENERATION_IDLE_TIMEOUT_MS,
  generationMaxDurationMs: DEFAULT_GENERATION_MAX_DURATION_MS,
};

let cachedChat: ChatMeta | null = null;

/** Coerce a value to an integer max tool turn count in [1, 64]. */
export function clampMaxToolTurns(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CHAT_MAX_TOOL_TURNS;
  return Math.min(64, Math.max(1, Math.round(n)));
}

/** Coerce idle timeout (ms) to server-allowed range. */
export function clampGenerationIdleTimeoutMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GENERATION_IDLE_TIMEOUT_MS;
  return Math.min(
    MAX_GENERATION_IDLE_TIMEOUT_MS,
    Math.max(MIN_GENERATION_IDLE_TIMEOUT_MS, Math.round(n)),
  );
}

/** Coerce max generation duration (ms) to server-allowed range. */
export function clampGenerationMaxDurationMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GENERATION_MAX_DURATION_MS;
  return Math.min(
    MAX_GENERATION_MAX_DURATION_MS,
    Math.max(MIN_GENERATION_MAX_DURATION_MS, Math.round(n)),
  );
}

/** Settings UI: whole minutes from milliseconds. */
export function generationTimeoutMsToMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/** Settings UI: milliseconds from whole minutes. */
export function generationTimeoutMinutesToMs(minutes: number): number {
  return Math.round(minutes) * 60_000;
}

function parseChatBlock(raw: unknown): ChatMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CHAT_META };
  }
  const block = raw as Record<string, unknown>;
  return {
    maxToolTurns: clampMaxToolTurns(block.maxToolTurns),
    generationIdleTimeoutMs: clampGenerationIdleTimeoutMs(block.generationIdleTimeoutMs),
    generationMaxDurationMs: clampGenerationMaxDurationMs(block.generationMaxDurationMs),
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

function mergeChatMeta(current: ChatMeta, patch: Partial<ChatMeta>): ChatMeta {
  return {
    maxToolTurns: clampMaxToolTurns(
      patch.maxToolTurns !== undefined ? patch.maxToolTurns : current.maxToolTurns,
    ),
    generationIdleTimeoutMs: clampGenerationIdleTimeoutMs(
      patch.generationIdleTimeoutMs !== undefined
        ? patch.generationIdleTimeoutMs
        : current.generationIdleTimeoutMs,
    ),
    generationMaxDurationMs: clampGenerationMaxDurationMs(
      patch.generationMaxDurationMs !== undefined
        ? patch.generationMaxDurationMs
        : current.generationMaxDurationMs,
    ),
  };
}

/** Persist partial updates via PUT /api/config/meta and mirror to localStorage. */
export async function saveChatMeta(patch: Partial<ChatMeta>): Promise<void> {
  const current = await loadChatMeta();
  const next = mergeChatMeta(current, patch);
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
export function setChatMetaForTests(patch: Partial<ChatMeta>): void {
  cachedChat = mergeChatMeta(cachedChat ?? { ...DEFAULT_CHAT_META }, patch);
}
