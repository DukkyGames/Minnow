/**
 * Editor Intent mode settings from config.json meta (MIN-131).
 */

import { detectConfigServer } from './storage-mode';

export interface EditorIntentModeConfig {
  /** Default Intent mode on when opening a file in the editor. */
  enabledByDefault: boolean;
  /** Auto-recheck stale resolved lines after neighbor edits (default off). */
  autoRecheckDefault: boolean;
  /** Debounce before resolving a line after leaving it. */
  debounceMs: number;
  /** Lines of resolved context above/below the intent line. */
  contextWindow: number;
  /** Delay before auto-recheck re-resolves a stale region. */
  recheckDelayMs: number;
  /** Max auto-recheck passes per user-edit burst. */
  maxRecheckPasses: number;
}

const STORAGE_KEY = 'minnow.editorIntentMode';

export const DEFAULT_EDITOR_INTENT_MODE: EditorIntentModeConfig = {
  enabledByDefault: false,
  autoRecheckDefault: false,
  debounceMs: 450,
  contextWindow: 5,
  recheckDelayMs: 600,
  maxRecheckPasses: 8,
};

let cached: EditorIntentModeConfig | null = null;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Parse a partial meta block into a full Intent mode config object. */
export function parseEditorIntentModeBlock(raw: unknown): EditorIntentModeConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EDITOR_INTENT_MODE };
  }
  const block = raw as Record<string, unknown>;
  return {
    enabledByDefault: block.enabledByDefault === true,
    autoRecheckDefault: block.autoRecheckDefault === true,
    debounceMs: clampInt(block.debounceMs, 200, 2000, DEFAULT_EDITOR_INTENT_MODE.debounceMs),
    contextWindow: clampInt(block.contextWindow, 1, 20, DEFAULT_EDITOR_INTENT_MODE.contextWindow),
    recheckDelayMs: clampInt(
      block.recheckDelayMs,
      200,
      5000,
      DEFAULT_EDITOR_INTENT_MODE.recheckDelayMs,
    ),
    maxRecheckPasses: clampInt(
      block.maxRecheckPasses,
      1,
      32,
      DEFAULT_EDITOR_INTENT_MODE.maxRecheckPasses,
    ),
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
    autoRecheckDefault:
      patch.autoRecheckDefault !== undefined
        ? patch.autoRecheckDefault
        : current.autoRecheckDefault,
    debounceMs:
      patch.debounceMs !== undefined
        ? clampInt(patch.debounceMs, 200, 2000, current.debounceMs)
        : current.debounceMs,
    contextWindow:
      patch.contextWindow !== undefined
        ? clampInt(patch.contextWindow, 1, 20, current.contextWindow)
        : current.contextWindow,
    recheckDelayMs:
      patch.recheckDelayMs !== undefined
        ? clampInt(patch.recheckDelayMs, 200, 5000, current.recheckDelayMs)
        : current.recheckDelayMs,
    maxRecheckPasses:
      patch.maxRecheckPasses !== undefined
        ? clampInt(patch.maxRecheckPasses, 1, 32, current.maxRecheckPasses)
        : current.maxRecheckPasses,
  };
  cached = next;
  writeLocal(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editorIntentMode: next }),
  });
}
