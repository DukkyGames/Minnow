/**
 * Constrained tool-call settings in ~/.minnow/config.json (`toolCalls` block).
 */

import { detectConfigServer } from './storage-mode';

export interface ToolCallsMeta {
  /** Global default for constrained decoding (per-provider can override). */
  useConstrainedDecoding: boolean;
}

const STORAGE_KEY = 'minnow.toolCallsMeta';

const DEFAULT_TOOL_CALLS_META: ToolCallsMeta = {
  useConstrainedDecoding: false,
};

let cached: ToolCallsMeta | null = null;

function parseToolCallsBlock(raw: unknown): ToolCallsMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TOOL_CALLS_META };
  }
  const block = raw as Record<string, unknown>;
  return {
    useConstrainedDecoding: block.useConstrainedDecoding === true,
  };
}

function readLocal(): ToolCallsMeta {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TOOL_CALLS_META };
    return parseToolCallsBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TOOL_CALLS_META };
  }
}

function writeLocal(config: ToolCallsMeta): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchFromServer(): Promise<ToolCallsMeta> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocal();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseToolCallsBlock(meta.toolCalls);
}

/** Load toolCalls meta (cached). */
export async function loadToolCallsMeta(): Promise<ToolCallsMeta> {
  if (cached) return cached;
  const serverUp = await detectConfigServer();
  cached = serverUp ? await fetchFromServer() : readLocal();
  writeLocal(cached);
  return cached;
}

/** Sync read before async load completes. */
export function getToolCallsMetaSync(): ToolCallsMeta {
  return cached ?? readLocal();
}

/** Persist partial updates. */
export async function saveToolCallsMeta(patch: Partial<ToolCallsMeta>): Promise<void> {
  const current = await loadToolCallsMeta();
  const next: ToolCallsMeta = {
    useConstrainedDecoding:
      patch.useConstrainedDecoding !== undefined
        ? patch.useConstrainedDecoding === true
        : current.useConstrainedDecoding,
  };
  cached = next;
  writeLocal(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolCalls: next }),
  });
}

/** Clear cache (tests). */
export function resetToolCallsMetaCache(): void {
  cached = null;
}

/** Override cache (tests). */
export function setToolCallsMetaForTests(config: ToolCallsMeta): void {
  cached = config;
}

/**
 * Effective constrained flag: per-provider profile override, else global default.
 */
export function isConstrainedDecodingEnabledForProvider(
  provider: { constrainedToolCalls?: boolean },
  global: ToolCallsMeta,
): boolean {
  if (provider.constrainedToolCalls === true) return true;
  if (provider.constrainedToolCalls === false) return false;
  return global.useConstrainedDecoding;
}
