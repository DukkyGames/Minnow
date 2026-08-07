/**
 * research.json — Deep Research engine parameters and dedicated model binding.
 */

import type { SearchProvider } from './search-config';

export interface ResearchModelBinding {
  providerId: string;
  model: string;
}

export interface ResearchConfig {
  model: ResearchModelBinding;
  /** Optional override of search.json primary provider (empty = use search.json). */
  searchProvider: SearchProvider | '';
  maxRounds: number;
  minRounds: number;
  maxTimeSeconds: number;
  runTimeoutSeconds: number;
  maxReportTokens: number;
  extractionTimeoutSeconds: number;
  extractionConcurrency: number;
  maxUrlsPerRound: number;
  maxContentChars: number;
  synthesisWindow: number;
  maxEmptyRounds: number;
}

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  model: { providerId: '', model: '' },
  searchProvider: '',
  maxRounds: 0,
  minRounds: 3,
  maxTimeSeconds: 300,
  runTimeoutSeconds: 1800,
  maxReportTokens: 16384,
  extractionTimeoutSeconds: 90,
  extractionConcurrency: 3,
  maxUrlsPerRound: 3,
  maxContentChars: 15000,
  synthesisWindow: 10,
  maxEmptyRounds: 2,
};

let cachedResearch: ResearchConfig | null = null;

/** Clear in-memory cache (tests). */
export function resetResearchConfigCache(): void {
  cachedResearch = null;
}

/** Cached config when already fetched; otherwise defaults (sync UI paths). */
export function peekResearchConfig(): ResearchConfig {
  return cachedResearch ? { ...cachedResearch } : { ...DEFAULT_RESEARCH_CONFIG };
}

/** GET /api/config/research (cached until reset). */
export async function loadResearchConfig(): Promise<ResearchConfig> {
  if (cachedResearch) return cachedResearch;
  try {
    const res = await fetch('/api/config/research', { cache: 'no-store' });
    if (!res.ok) {
      return { ...DEFAULT_RESEARCH_CONFIG };
    }
    const data = (await res.json()) as ResearchConfig;
    cachedResearch = { ...DEFAULT_RESEARCH_CONFIG, ...data };
    return cachedResearch;
  } catch {
    return { ...DEFAULT_RESEARCH_CONFIG };
  }
}

/** PUT /api/config/research and refresh cache. */
export async function saveResearchConfig(config: ResearchConfig): Promise<ResearchConfig> {
  const res = await fetch('/api/config/research', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      errBody && typeof errBody === 'object' && 'error' in errBody
        ? String((errBody as { error: unknown }).error)
        : res.statusText;
    throw new Error(message || `Config API ${res.status}`);
  }
  const payload = (await res.json()) as { data?: ResearchConfig };
  cachedResearch = payload.data ?? config;
  return cachedResearch;
}
