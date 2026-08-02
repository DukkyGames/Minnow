/**
 * Bounded LRU/TTL cache for editor AI inline completions (Phase 6).
 */

import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { completionModeAt } from './editor-completion-policy';
import { PROMPT_VERSION } from './editor-ai-completion-prompt';

/** Default time-to-live for cached completions (5 minutes). */
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Default maximum number of cached completions. */
export const DEFAULT_CACHE_MAX_ENTRIES = 200;

/** Stable hash for cache keys (djb2 → base36). */
export function hashCompletionContext(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Inputs that isolate a cached completion from other providers/models/settings. */
export interface CompletionCacheKeyInput {
  providerId: string;
  modelId: string;
  promptVersion?: string;
  config: EditorAiCompletionConfig;
  filePath: string;
  prefix: string;
  suffix: string;
}

/** Hash relevant settings so cache entries do not cross configuration boundaries. */
export function hashCompletionSettings(config: EditorAiCompletionConfig): string {
  const payload = [
    config.temperature,
    config.maxTokens,
    config.maxPrefixLines,
    config.maxSuffixLines,
    config.maxPrefixChars,
    config.maxSuffixChars,
    config.includeImportContext,
    config.includeLspHover,
    config.includeLspContext,
    config.contextBudgetChars,
    completionModeAt(config),
  ].join('\0');
  return hashCompletionContext(payload);
}

/** Full cache key: provider, model, prompt version, settings, path, prefix/suffix. */
export function buildCompletionCacheKey(input: CompletionCacheKeyInput): string {
  const prefixTail = input.prefix.slice(-512);
  const suffixHead = input.suffix.slice(0, 512);
  const version = input.promptVersion ?? PROMPT_VERSION;
  const settingsHash = hashCompletionSettings(input.config);
  const payload = [
    input.providerId,
    input.modelId,
    version,
    settingsHash,
    input.filePath,
    prefixTail,
    suffixHead,
  ].join('\0');
  return hashCompletionContext(payload);
}

interface CacheEntry {
  text: string;
  expiresAt: number;
}

/** LRU/TTL in-memory completion cache (cleared on full page reload). */
export class EditorAiCompletionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(
    maxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    ttlMs = DEFAULT_CACHE_TTL_MS,
  ) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /** Read a validated completion when present and not expired. */
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Touch for LRU ordering.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.text;
  }

  /** Store only a final validated completion text. */
  set(key: string, text: string): void {
    if (!text) return;
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { text, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Shared process-wide cache instance. */
export const editorAiCompletionCache = new EditorAiCompletionCache();

/** Clear completion cache (tests). */
export function resetEditorAiCompletionCache(): void {
  editorAiCompletionCache.clear();
}
