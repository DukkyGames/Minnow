/**
 * Global thinking default in ~/.minnow/config.json (`thinking` block).
 */

import {
  normalizeThinkingGlobalDefault,
  type ThinkingGlobalDefault,
} from '../agents/thinking-types';
import { detectConfigServer } from './storage-mode';

export interface ThinkingGlobalMeta {
  defaultMode: ThinkingGlobalDefault;
}

export const DEFAULT_THINKING_GLOBAL: ThinkingGlobalMeta = {
  defaultMode: 'on',
};

const THINKING_META_STORAGE_KEY = 'minnow.thinkingMeta';

let cachedThinking: ThinkingGlobalMeta | null = null;

function parseThinkingBlock(raw: unknown): ThinkingGlobalMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_THINKING_GLOBAL };
  }
  const block = raw as Record<string, unknown>;
  return {
    defaultMode: normalizeThinkingGlobalDefault(block.defaultMode, 'on'),
  };
}

function readLocalThinkingMeta(): ThinkingGlobalMeta {
  try {
    const raw = localStorage.getItem(THINKING_META_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THINKING_GLOBAL };
    return parseThinkingBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_THINKING_GLOBAL };
  }
}

function writeLocalThinkingMeta(config: ThinkingGlobalMeta): void {
  localStorage.setItem(THINKING_META_STORAGE_KEY, JSON.stringify(config));
}

async function fetchThinkingFromServer(): Promise<ThinkingGlobalMeta> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalThinkingMeta();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseThinkingBlock(meta.thinking);
}

/** Load global thinking meta (cached until reset). */
export async function loadThinkingMeta(): Promise<ThinkingGlobalMeta> {
  if (cachedThinking) return cachedThinking;
  const serverUp = await detectConfigServer();
  cachedThinking = serverUp ? await fetchThinkingFromServer() : readLocalThinkingMeta();
  writeLocalThinkingMeta(cachedThinking);
  return cachedThinking;
}

export function getThinkingMetaSync(): ThinkingGlobalMeta {
  return cachedThinking ?? readLocalThinkingMeta();
}

export function resetThinkingMetaCache(): void {
  cachedThinking = null;
}

export function setThinkingMetaForTests(config: ThinkingGlobalMeta): void {
  cachedThinking = config;
}

/** Persist partial global thinking via PUT /api/config/meta. */
export async function saveThinkingMeta(
  patch: Partial<ThinkingGlobalMeta>,
): Promise<ThinkingGlobalMeta> {
  const current = await loadThinkingMeta();
  const merged: ThinkingGlobalMeta = {
    defaultMode: patch.defaultMode
      ? normalizeThinkingGlobalDefault(patch.defaultMode, current.defaultMode)
      : current.defaultMode,
  };
  cachedThinking = merged;
  writeLocalThinkingMeta(merged);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thinking: merged }),
  });
  return merged;
}
