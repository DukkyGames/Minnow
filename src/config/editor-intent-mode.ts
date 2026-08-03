/**
 * Editor Intent mode settings from config.json meta (MIN-131).
 */

import { detectConfigServer } from './storage-mode';

export interface EditorIntentModeConfig {
  /** Default Intent mode on when opening a file in the editor. */
  enabledByDefault: boolean;
  /** Idle pause on an intent line before a proposal is requested. */
  debounceMs: number;
  /**
   * Optional explicit prefix. When set, only lines starting with it are treated
   * as intent — the prose heuristic is bypassed entirely.
   */
  sigil: string;
  /** Optional provider pin; empty falls back to the inline-completion binding. */
  providerId: string;
  /** Optional model pin; empty falls back to the inline-completion binding. */
  modelId: string;
  /** Token budget for the replacement block (floored at 768 by the resolver). */
  maxTokens: number;
}

const STORAGE_KEY = 'minnow.editorIntentMode';

export const DEFAULT_EDITOR_INTENT_MODE: EditorIntentModeConfig = {
  enabledByDefault: false,
  debounceMs: 400,
  sigil: '',
  providerId: '',
  modelId: '',
  maxTokens: 768,
};

let cached: EditorIntentModeConfig | null = null;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

/** Parse a partial meta block into a full Intent mode config object. */
export function parseEditorIntentModeBlock(raw: unknown): EditorIntentModeConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EDITOR_INTENT_MODE };
  }
  const block = raw as Record<string, unknown>;
  return {
    enabledByDefault: block.enabledByDefault === true,
    debounceMs: clampInt(block.debounceMs, 100, 2000, DEFAULT_EDITOR_INTENT_MODE.debounceMs),
    sigil: readString(block.sigil, DEFAULT_EDITOR_INTENT_MODE.sigil),
    providerId: readString(block.providerId, DEFAULT_EDITOR_INTENT_MODE.providerId),
    modelId: readString(block.modelId, DEFAULT_EDITOR_INTENT_MODE.modelId),
    maxTokens: clampInt(block.maxTokens, 128, 4096, DEFAULT_EDITOR_INTENT_MODE.maxTokens),
  };
}

function readLocal(): EditorIntentModeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EDITOR_INTENT_MODE };
    return parseEditorIntentModeBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EDITOR_INTENT_MODE };
  }
}

function writeLocal(config: EditorIntentModeConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchFromServer(): Promise<EditorIntentModeConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocal();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseEditorIntentModeBlock(meta.editorIntentMode);
}

/** Load Intent mode config (cached until reset). */
export async function loadEditorIntentModeConfig(): Promise<EditorIntentModeConfig> {
  if (cached) return cached;
  const serverUp = await detectConfigServer();
  cached = serverUp ? await fetchFromServer() : readLocal();
  writeLocal(cached);
  return cached;
}

/** Synchronous read of last loaded or local fallback. */
export function getEditorIntentModeConfigSync(): EditorIntentModeConfig {
  return cached ?? readLocal();
}

/** Clear cache (tests). */
export function resetEditorIntentModeConfigCache(): void {
  cached = null;
}

/** Override cache for tests. */
export function setEditorIntentModeConfigForTests(config: EditorIntentModeConfig): void {
  cached = config;
}

/** Persist partial Intent mode config via PUT /api/config/meta. */
export async function saveEditorIntentModeConfig(
  patch: Partial<EditorIntentModeConfig>,
): Promise<void> {
  const current = await loadEditorIntentModeConfig();
  const next: EditorIntentModeConfig = {
    enabledByDefault:
      patch.enabledByDefault !== undefined
        ? patch.enabledByDefault
        : current.enabledByDefault,
    debounceMs:
      patch.debounceMs !== undefined
        ? clampInt(patch.debounceMs, 100, 2000, current.debounceMs)
        : current.debounceMs,
    sigil: patch.sigil !== undefined ? patch.sigil.trim() : current.sigil,
    providerId:
      patch.providerId !== undefined ? patch.providerId.trim() : current.providerId,
    modelId: patch.modelId !== undefined ? patch.modelId.trim() : current.modelId,
    maxTokens:
      patch.maxTokens !== undefined
        ? clampInt(patch.maxTokens, 128, 4096, current.maxTokens)
        : current.maxTokens,
  };
  cached = next;
  writeLocal(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editorIntentMode: next }),
  });
}
