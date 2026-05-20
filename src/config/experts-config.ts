/**
 * Experts feature flags from config.json + localStorage fallback.
 */

import { detectConfigServer } from './storage-mode';
import {
  DEFAULT_EXPERTS_CONFIG,
  type ExpertClassifierMode,
  type ExpertsConfig,
} from '../chat/experts/types';

const EXPERTS_STORAGE_KEY = 'minnow.experts';

let cachedConfig: ExpertsConfig | null = null;

function parseClassifierMode(value: unknown): ExpertClassifierMode {
  if (value === 'llm' || value === 'rules+llm' || value === 'rules') return value;
  return 'rules';
}

function normalizeExpertsBlock(raw: unknown): ExpertsConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EXPERTS_CONFIG };
  const row = raw as Record<string, unknown>;
  return {
    enabled: row.enabled !== false,
    classifier: parseClassifierMode(row.classifier),
    llmFallbackBelow:
      typeof row.llmFallbackBelow === 'number' ? row.llmFallbackBelow : 0.55,
    rulesMinScore: typeof row.rulesMinScore === 'number' ? row.rulesMinScore : 3,
    autoOmitWhenNoMatch: row.autoOmitWhenNoMatch === true,
    classifierModel:
      row.classifierModel &&
      typeof row.classifierModel === 'object' &&
      typeof (row.classifierModel as { providerId?: string }).providerId === 'string'
        ? {
            providerId: String((row.classifierModel as { providerId: string }).providerId),
            modelId: String((row.classifierModel as { modelId?: string }).modelId ?? ''),
          }
        : undefined,
  };
}

function readLocalExpertsConfig(): ExpertsConfig {
  try {
    const raw = localStorage.getItem(EXPERTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPERTS_CONFIG };
    const parsed = JSON.parse(raw) as { experts?: unknown };
    return normalizeExpertsBlock(parsed.experts ?? parsed);
  } catch {
    return { ...DEFAULT_EXPERTS_CONFIG };
  }
}

function writeLocalExpertsConfig(config: ExpertsConfig): void {
  localStorage.setItem(EXPERTS_STORAGE_KEY, JSON.stringify({ experts: config }));
}

async function fetchExpertsFromServer(): Promise<ExpertsConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalExpertsConfig();
  const meta = (await res.json()) as Record<string, unknown>;
  return normalizeExpertsBlock(meta.experts);
}

/** Load experts config (cached). */
export async function loadExpertsConfig(): Promise<ExpertsConfig> {
  if (cachedConfig) return cachedConfig;
  const serverUp = await detectConfigServer();
  cachedConfig = serverUp ? await fetchExpertsFromServer() : readLocalExpertsConfig();
  return cachedConfig;
}

/** Synchronous read after first load. */
export function getExpertsConfigSync(): ExpertsConfig {
  return cachedConfig ?? readLocalExpertsConfig();
}

/** Persist experts config (merge into meta or localStorage). */
export async function saveExpertsConfig(partial: Partial<ExpertsConfig>): Promise<ExpertsConfig> {
  const current = await loadExpertsConfig();
  const next: ExpertsConfig = { ...current, ...partial };
  cachedConfig = next;
  writeLocalExpertsConfig(next);

  const serverUp = await detectConfigServer();
  if (serverUp) {
    await fetch('/api/config/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experts: next }),
    });
  }

  return next;
}

export function resetExpertsConfigCache(): void {
  cachedConfig = null;
}
