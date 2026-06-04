/**
 * File editor display settings from config.json meta (word wrap, tab size, font).
 */

import { detectConfigServer } from './storage-mode';

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  renderWhitespace: boolean;
}

const STORAGE_KEY = 'minnow.editorSettings';

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  renderWhitespace: false,
};

let cached: EditorSettings | null = null;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Parse a partial meta block into editor settings. */
export function parseEditorSettingsBlock(raw: unknown): EditorSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
  const block = raw as Record<string, unknown>;
  return {
    fontSize: clampInt(block.fontSize, 10, 24, DEFAULT_EDITOR_SETTINGS.fontSize),
    tabSize: clampInt(block.tabSize, 1, 8, DEFAULT_EDITOR_SETTINGS.tabSize),
    wordWrap: block.wordWrap === true,
    renderWhitespace: block.renderWhitespace === true,
  };
}

function readLocal(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EDITOR_SETTINGS };
    return parseEditorSettingsBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
}

function writeLocal(config: EditorSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchFromServer(): Promise<EditorSettings> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocal();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseEditorSettingsBlock(meta.editorSettings);
}

/** Load editor settings (cached until reset). */
export async function loadEditorSettings(): Promise<EditorSettings> {
  if (cached) return cached;
  const serverUp = await detectConfigServer();
  cached = serverUp ? await fetchFromServer() : readLocal();
  writeLocal(cached);
  return cached;
}

/** Synchronous read of last loaded or local fallback. */
export function getEditorSettingsSync(): EditorSettings {
  return cached ?? readLocal();
}

/** Clear cache (tests). */
export function resetEditorSettingsCache(): void {
  cached = null;
}

/** Override cache for tests. */
export function setEditorSettingsForTests(config: EditorSettings): void {
  cached = config;
}

/** Persist partial editor settings via PUT /api/config/meta. */
export async function saveEditorSettings(patch: Partial<EditorSettings>): Promise<void> {
  const current = await loadEditorSettings();
  const next: EditorSettings = {
    fontSize:
      patch.fontSize !== undefined
        ? clampInt(patch.fontSize, 10, 24, current.fontSize)
        : current.fontSize,
    tabSize:
      patch.tabSize !== undefined
        ? clampInt(patch.tabSize, 1, 8, current.tabSize)
        : current.tabSize,
    wordWrap: patch.wordWrap !== undefined ? patch.wordWrap : current.wordWrap,
    renderWhitespace:
      patch.renderWhitespace !== undefined ? patch.renderWhitespace : current.renderWhitespace,
  };
  cached = next;
  writeLocal(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editorSettings: next }),
  });
}
