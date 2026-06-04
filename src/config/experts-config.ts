import { detectConfigServer } from './storage-mode';
import { DEFAULT_EXPERTS_CONFIG, type ExpertsConfig } from '../chat/experts/types';
const EXPERTS_STORAGE_KEY = 'minnow.experts';
let cachedConfig: ExpertsConfig | null = null;
function normalizeExpertsBlock(raw: unknown): ExpertsConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EXPERTS_CONFIG };
  return { enabled: (raw as Record<string, unknown>).enabled !== false };
}
function readLocalExpertsConfig(): ExpertsConfig {
  try {
    const raw = localStorage.getItem(EXPERTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPERTS_CONFIG };
    return normalizeExpertsBlock(JSON.parse(raw).experts ?? JSON.parse(raw));
  } catch { return { ...DEFAULT_EXPERTS_CONFIG }; }
}
function writeLocalExpertsConfig(config: ExpertsConfig): void {
  localStorage.setItem(EXPERTS_STORAGE_KEY, JSON.stringify({ experts: config }));
}
async function fetchExpertsFromServer(): Promise<ExpertsConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalExpertsConfig();
  return normalizeExpertsBlock((await res.json()).experts);
}
export async function loadExpertsConfig(): Promise<ExpertsConfig> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = (await detectConfigServer()) ? await fetchExpertsFromServer() : readLocalExpertsConfig();
  return cachedConfig;
}
export function getExpertsConfigSync(): ExpertsConfig { return cachedConfig ?? readLocalExpertsConfig(); }
export async function saveExpertsConfig(partial: Partial<ExpertsConfig>): Promise<ExpertsConfig> {
  const next = { ...(await loadExpertsConfig()), ...partial };
  cachedConfig = next;
  writeLocalExpertsConfig(next);
  if (await detectConfigServer()) {
    await fetch('/api/config/meta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experts: next }) });
  }
  return next;
}
export function resetExpertsConfigCache(): void { cachedConfig = null; }
