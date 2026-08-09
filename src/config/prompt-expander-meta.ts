/**
 * Composer prompt expander model settings from config.json meta.
 */

import { detectConfigServer } from './storage-mode';

export interface PromptExpanderConfig {
  modelId: string;
  providerId: string;
}

const PROMPT_EXPANDER_META_STORAGE_KEY = 'minnow.promptExpanderMeta';

export const DEFAULT_PROMPT_EXPANDER_CONFIG: PromptExpanderConfig = {
  modelId: '',
  providerId: '',
};

let cachedPromptExpander: PromptExpanderConfig | null = null;

function parsePromptExpanderBlock(raw: unknown): PromptExpanderConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PROMPT_EXPANDER_CONFIG };
  }
  const block = raw as Record<string, unknown>;
  return {
    modelId: typeof block.modelId === 'string' ? block.modelId : '',
    providerId: typeof block.providerId === 'string' ? block.providerId : '',
  };
}

function readLocalPromptExpanderConfig(): PromptExpanderConfig {
  try {
    const raw = localStorage.getItem(PROMPT_EXPANDER_META_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROMPT_EXPANDER_CONFIG };
    return parsePromptExpanderBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PROMPT_EXPANDER_CONFIG };
  }
}

function writeLocalPromptExpanderConfig(config: PromptExpanderConfig): void {
  localStorage.setItem(PROMPT_EXPANDER_META_STORAGE_KEY, JSON.stringify(config));
}

async function fetchPromptExpanderFromServer(): Promise<PromptExpanderConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalPromptExpanderConfig();
  const meta = (await res.json()) as Record<string, unknown>;
  return parsePromptExpanderBlock(meta.promptExpander);
}

/** Load prompt expander routing config (cached until reset). */
export async function loadPromptExpanderConfig(): Promise<PromptExpanderConfig> {
  if (cachedPromptExpander) return cachedPromptExpander;

  const serverUp = await detectConfigServer();
  cachedPromptExpander = serverUp
    ? await fetchPromptExpanderFromServer()
    : readLocalPromptExpanderConfig();
  writeLocalPromptExpanderConfig(cachedPromptExpander);
  return cachedPromptExpander;
}

/** Synchronous read of last loaded or local fallback. */
export function getPromptExpanderConfigSync(): PromptExpanderConfig {
  return cachedPromptExpander ?? readLocalPromptExpanderConfig();
}

/** Clear cache (tests). */
export function resetPromptExpanderConfigCache(): void {
  cachedPromptExpander = null;
}

/** Override cache for tests (no localStorage). */
export function setPromptExpanderConfigForTests(config: PromptExpanderConfig): void {
  cachedPromptExpander = config;
}

/** Persist partial prompt expander config via PUT /api/config/meta. */
export async function savePromptExpanderConfig(
  patch: Partial<PromptExpanderConfig>,
): Promise<void> {
  const current = await loadPromptExpanderConfig();
  const next: PromptExpanderConfig = {
    modelId: patch.modelId !== undefined ? patch.modelId : current.modelId,
    providerId: patch.providerId !== undefined ? patch.providerId : current.providerId,
  };
  cachedPromptExpander = next;
  writeLocalPromptExpanderConfig(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptExpander: next }),
  });
}
