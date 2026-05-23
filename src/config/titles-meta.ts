/**
 * Title generation settings from config.json meta (Step 07).
 */

import { detectConfigServer } from './storage-mode';

export interface TitlesConfig {
  enabled: boolean;
  modelId: string;
  providerId: string;
  maxTokens: number;
  temperature: number;
}

const TITLES_META_STORAGE_KEY = 'minnow.titlesMeta';

export const DEFAULT_TITLES_CONFIG: TitlesConfig = {
  enabled: true,
  modelId: '',
  providerId: '',
  maxTokens: 24,
  temperature: 0.3,
};

let cachedTitles: TitlesConfig | null = null;

function clampMaxTokens(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TITLES_CONFIG.maxTokens;
  return Math.min(32, Math.max(16, Math.round(n)));
}

function clampTemperature(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TITLES_CONFIG.temperature;
  return Math.min(0.4, Math.max(0.2, n));
}

function parseTitlesBlock(raw: unknown): TitlesConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TITLES_CONFIG };
  }
  const block = raw as Record<string, unknown>;
  return {
    enabled: block.enabled !== false,
    modelId: typeof block.modelId === 'string' ? block.modelId : '',
    providerId: typeof block.providerId === 'string' ? block.providerId : '',
    maxTokens: clampMaxTokens(block.maxTokens),
    temperature: clampTemperature(block.temperature),
  };
}

function readLocalTitlesConfig(): TitlesConfig {
  try {
    const raw = localStorage.getItem(TITLES_META_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TITLES_CONFIG };
    return parseTitlesBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TITLES_CONFIG };
  }
}

function writeLocalTitlesConfig(config: TitlesConfig): void {
  localStorage.setItem(TITLES_META_STORAGE_KEY, JSON.stringify(config));
}

async function fetchTitlesFromServer(): Promise<TitlesConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalTitlesConfig();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseTitlesBlock(meta.titles);
}

/** Load titles config (cached until reset). */
export async function loadTitlesConfig(): Promise<TitlesConfig> {
  if (cachedTitles) return cachedTitles;

  const serverUp = await detectConfigServer();
  cachedTitles = serverUp ? await fetchTitlesFromServer() : readLocalTitlesConfig();
  writeLocalTitlesConfig(cachedTitles);
  return cachedTitles;
}

/** Synchronous read of last loaded or local fallback. */
export function getTitlesConfigSync(): TitlesConfig {
  return cachedTitles ?? readLocalTitlesConfig();
}

/** Clear cache (tests). */
export function resetTitlesConfigCache(): void {
  cachedTitles = null;
}

/** Override cache for tests (no localStorage). */
export function setTitlesConfigForTests(config: TitlesConfig): void {
  cachedTitles = config;
}

/** Persist partial titles config via PUT /api/config/meta and mirror to localStorage. */
export async function saveTitlesConfig(patch: Partial<TitlesConfig>): Promise<void> {
  const current = await loadTitlesConfig();
  const next: TitlesConfig = {
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    modelId: patch.modelId !== undefined ? patch.modelId : current.modelId,
    providerId: patch.providerId !== undefined ? patch.providerId : current.providerId,
    maxTokens:
      patch.maxTokens !== undefined ? clampMaxTokens(patch.maxTokens) : current.maxTokens,
    temperature:
      patch.temperature !== undefined
        ? clampTemperature(patch.temperature)
        : current.temperature,
  };
  cachedTitles = next;
  writeLocalTitlesConfig(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titles: next }),
  });
}
