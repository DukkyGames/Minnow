/**
 * Editor AI inline completion settings from config.json meta (POLISH-006).
 */

import { detectConfigServer } from './storage-mode';

export interface EditorAiCompletionConfig {
  enabled: boolean;
  debounceMs: number;
  maxPrefixLines: number;
  maxSuffixLines: number;
  maxPrefixChars: number;
  maxSuffixChars: number;
  temperature: number;
  maxTokens: number;
  /** When true, use active chat provider/model unless overrides are set. */
  useChatModel: boolean;
  providerId: string;
  modelId: string;
  /** Include import/require lines from the file in the chat prompt. */
  includeImportContext: boolean;
  /** Fetch LSP hover at cursor for prompt context (no-op when unavailable). */
  includeLspHover: boolean;
  /** Use Qwen native FIM tokens when the model id matches. */
  useNativeFim: boolean;
  /** Cache completions by file path + prefix/suffix hash. */
  enableCompletionCache: boolean;
}

const STORAGE_KEY = 'minnow.editorAiCompletion';

export const DEFAULT_EDITOR_AI_COMPLETION: EditorAiCompletionConfig = {
  enabled: false,
  debounceMs: 450,
  maxPrefixLines: 80,
  maxSuffixLines: 40,
  maxPrefixChars: 6000,
  maxSuffixChars: 2000,
  temperature: 0.3,
  maxTokens: 256,
  useChatModel: true,
  providerId: '',
  modelId: '',
  includeImportContext: true,
  includeLspHover: true,
  useNativeFim: true,
  enableCompletionCache: true,
};

let cached: EditorAiCompletionConfig | null = null;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse a partial meta block into a full config object. */
export function parseEditorAiCompletionBlock(raw: unknown): EditorAiCompletionConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EDITOR_AI_COMPLETION };
  }
  const block = raw as Record<string, unknown>;
  return {
    enabled: block.enabled === true,
    debounceMs: clampInt(block.debounceMs, 200, 2000, DEFAULT_EDITOR_AI_COMPLETION.debounceMs),
    maxPrefixLines: clampInt(
      block.maxPrefixLines,
      10,
      200,
      DEFAULT_EDITOR_AI_COMPLETION.maxPrefixLines,
    ),
    maxSuffixLines: clampInt(
      block.maxSuffixLines,
      0,
      100,
      DEFAULT_EDITOR_AI_COMPLETION.maxSuffixLines,
    ),
    maxPrefixChars: clampInt(
      block.maxPrefixChars,
      500,
      20_000,
      DEFAULT_EDITOR_AI_COMPLETION.maxPrefixChars,
    ),
    maxSuffixChars: clampInt(
      block.maxSuffixChars,
      0,
      10_000,
      DEFAULT_EDITOR_AI_COMPLETION.maxSuffixChars,
    ),
    temperature: clampFloat(
      block.temperature,
      0,
      1,
      DEFAULT_EDITOR_AI_COMPLETION.temperature,
    ),
    maxTokens: clampInt(block.maxTokens, 16, 1024, DEFAULT_EDITOR_AI_COMPLETION.maxTokens),
    useChatModel: block.useChatModel !== false,
    providerId: typeof block.providerId === 'string' ? block.providerId : '',
    modelId: typeof block.modelId === 'string' ? block.modelId : '',
    includeImportContext: block.includeImportContext !== false,
    includeLspHover: block.includeLspHover !== false,
    useNativeFim: block.useNativeFim !== false,
    enableCompletionCache: block.enableCompletionCache !== false,
  };
}

function readLocal(): EditorAiCompletionConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EDITOR_AI_COMPLETION };
    return parseEditorAiCompletionBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EDITOR_AI_COMPLETION };
  }
}

function writeLocal(config: EditorAiCompletionConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchFromServer(): Promise<EditorAiCompletionConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocal();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseEditorAiCompletionBlock(meta.editorAiCompletion);
}

/** Load editor AI completion config (cached until reset). */
export async function loadEditorAiCompletionConfig(): Promise<EditorAiCompletionConfig> {
  if (cached) return cached;
  const serverUp = await detectConfigServer();
  cached = serverUp ? await fetchFromServer() : readLocal();
  writeLocal(cached);
  return cached;
}

/** Synchronous read of last loaded or local fallback. */
export function getEditorAiCompletionConfigSync(): EditorAiCompletionConfig {
  return cached ?? readLocal();
}

/** Clear cache (tests). */
export function resetEditorAiCompletionConfigCache(): void {
  cached = null;
}

/** Override cache for tests. */
export function setEditorAiCompletionConfigForTests(
  config: EditorAiCompletionConfig,
): void {
  cached = config;
}

/** Persist partial editor AI completion config via PUT /api/config/meta. */
export async function saveEditorAiCompletionConfig(
  patch: Partial<EditorAiCompletionConfig>,
): Promise<void> {
  const current = await loadEditorAiCompletionConfig();
  const next: EditorAiCompletionConfig = {
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    debounceMs:
      patch.debounceMs !== undefined
        ? clampInt(patch.debounceMs, 200, 2000, current.debounceMs)
        : current.debounceMs,
    maxPrefixLines:
      patch.maxPrefixLines !== undefined
        ? clampInt(patch.maxPrefixLines, 10, 200, current.maxPrefixLines)
        : current.maxPrefixLines,
    maxSuffixLines:
      patch.maxSuffixLines !== undefined
        ? clampInt(patch.maxSuffixLines, 0, 100, current.maxSuffixLines)
        : current.maxSuffixLines,
    maxPrefixChars:
      patch.maxPrefixChars !== undefined
        ? clampInt(patch.maxPrefixChars, 500, 20_000, current.maxPrefixChars)
        : current.maxPrefixChars,
    maxSuffixChars:
      patch.maxSuffixChars !== undefined
        ? clampInt(patch.maxSuffixChars, 0, 10_000, current.maxSuffixChars)
        : current.maxSuffixChars,
    temperature:
      patch.temperature !== undefined
        ? clampFloat(patch.temperature, 0, 1, current.temperature)
        : current.temperature,
    maxTokens:
      patch.maxTokens !== undefined
        ? clampInt(patch.maxTokens, 16, 1024, current.maxTokens)
        : current.maxTokens,
    useChatModel:
      patch.useChatModel !== undefined ? patch.useChatModel : current.useChatModel,
    providerId: patch.providerId !== undefined ? patch.providerId : current.providerId,
    modelId: patch.modelId !== undefined ? patch.modelId : current.modelId,
    includeImportContext:
      patch.includeImportContext !== undefined
        ? patch.includeImportContext
        : current.includeImportContext,
    includeLspHover:
      patch.includeLspHover !== undefined ? patch.includeLspHover : current.includeLspHover,
    useNativeFim:
      patch.useNativeFim !== undefined ? patch.useNativeFim : current.useNativeFim,
    enableCompletionCache:
      patch.enableCompletionCache !== undefined
        ? patch.enableCompletionCache
        : current.enableCompletionCache,
  };
  cached = next;
  writeLocal(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editorAiCompletion: next }),
  });
}
