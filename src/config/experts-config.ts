import { detectConfigServer } from './storage-mode';
import { DEFAULT_EXPERTS_CONFIG } from '../chat/experts/types';
import {
  normalizeExpertsConfig,
} from '../chat/experts/runtime-profile';
import type { ExpertRuntimeProfile, ExpertsConfig } from '../chat/experts/types';

export { normalizeExpertsConfig, normalizeExpertRuntimeProfile } from '../chat/experts/runtime-profile';
export type { ExpertRuntimeProfile, ExpertsConfig } from '../chat/experts/types';

const EXPERTS_STORAGE_KEY = 'minnow.experts';
let cachedConfig: ExpertsConfig | null = null;

function readLocalExpertsConfig(): ExpertsConfig {
  try {
    const raw = localStorage.getItem(EXPERTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPERTS_CONFIG, profiles: {} };
    return normalizeExpertsConfig(JSON.parse(raw).experts ?? JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EXPERTS_CONFIG, profiles: {} };
  }
}

function writeLocalExpertsConfig(config: ExpertsConfig): void {
  localStorage.setItem(EXPERTS_STORAGE_KEY, JSON.stringify({ experts: config }));
}

async function fetchExpertsFromServer(): Promise<ExpertsConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalExpertsConfig();
  return normalizeExpertsConfig((await res.json()).experts);
}

export async function loadExpertsConfig(): Promise<ExpertsConfig> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = (await detectConfigServer())
    ? await fetchExpertsFromServer()
    : readLocalExpertsConfig();
  return cachedConfig;
}

export function getExpertsConfigSync(): ExpertsConfig {
  return cachedConfig ?? readLocalExpertsConfig();
}

export async function saveExpertsConfig(partial: Partial<ExpertsConfig>): Promise<ExpertsConfig> {
  const current = await loadExpertsConfig();
  const next: ExpertsConfig = {
    enabled: partial.enabled ?? current.enabled,
    profiles: partial.profiles ? { ...partial.profiles } : { ...current.profiles },
  };
  cachedConfig = next;
  writeLocalExpertsConfig(next);
  if (await detectConfigServer()) {
    await fetch('/api/config/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experts: next }),
    });
  }
  return next;
}

/** Persist one expert's runtime profile (merge into profiles map). */
export async function saveExpertRuntimeProfile(
  expertId: string,
  profile: ExpertRuntimeProfile | null,
): Promise<ExpertsConfig> {
  const current = await loadExpertsConfig();
  const id = expertId.trim();
  const profiles = { ...current.profiles };
  if (!profile) {
    delete profiles[id];
  } else {
    profiles[id] = profile;
  }
  return saveExpertsConfig({ profiles });
}

export function resetExpertsConfigCache(): void {
  cachedConfig = null;
}
