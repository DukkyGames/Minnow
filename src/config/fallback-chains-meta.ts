/**
 * Fallback chain settings from config.json meta (Odysseus port #04).
 */

import { detectConfigServer } from './storage-mode';

export type FallbackRole = 'default' | 'utility' | 'vision' | 'research';

export interface FallbackChainCandidate {
  providerId: string;
  modelId: string;
}

export interface FallbackChainsConfig {
  enabled: boolean;
  cooldownSeconds: number;
  maxChainLength: number;
  roles: Record<FallbackRole, FallbackChainCandidate[]>;
}

const STORAGE_KEY = 'minnow.fallbackChainsMeta';

export const DEFAULT_FALLBACK_CHAINS_CONFIG: FallbackChainsConfig = {
  enabled: false,
  cooldownSeconds: 60,
  maxChainLength: 4,
  roles: {
    default: [],
    utility: [],
    research: [],
    vision: [],
  },
};

const ROLE_KEYS: FallbackRole[] = ['default', 'utility', 'research', 'vision'];

let cached: FallbackChainsConfig | null = null;

function clampCooldown(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_FALLBACK_CHAINS_CONFIG.cooldownSeconds;
  return Math.min(3600, Math.max(10, Math.round(n)));
}

function clampMaxChainLength(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_FALLBACK_CHAINS_CONFIG.maxChainLength;
  return Math.min(8, Math.max(1, Math.round(n)));
}

function parseCandidate(raw: unknown): FallbackChainCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.providerId !== 'string' || !row.providerId.trim()) return null;
  return {
    providerId: row.providerId.trim(),
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
  };
}

function parseRoles(raw: unknown): Record<FallbackRole, FallbackChainCandidate[]> {
  const roles = { ...DEFAULT_FALLBACK_CHAINS_CONFIG.roles };
  if (!raw || typeof raw !== 'object') return roles;
  const block = raw as Record<string, unknown>;
  for (const role of ROLE_KEYS) {
    const entries = block[role];
    if (!Array.isArray(entries)) continue;
    roles[role] = entries
      .map((entry) => parseCandidate(entry))
      .filter((entry): entry is FallbackChainCandidate => entry !== null);
  }
  return roles;
}

function parseFallbackChainsBlock(raw: unknown): FallbackChainsConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_FALLBACK_CHAINS_CONFIG };
  }
  const block = raw as Record<string, unknown>;
  return {
    enabled: block.enabled === true,
    cooldownSeconds: clampCooldown(block.cooldownSeconds),
    maxChainLength: clampMaxChainLength(block.maxChainLength),
    roles: parseRoles(block.roles),
  };
}

function readLocalConfig(): FallbackChainsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FALLBACK_CHAINS_CONFIG };
    return parseFallbackChainsBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FALLBACK_CHAINS_CONFIG };
  }
}

function writeLocalConfig(config: FallbackChainsConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchFromServer(): Promise<FallbackChainsConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalConfig();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseFallbackChainsBlock(meta.fallbackChains);
}

/** Load fallback chain config (cached until reset). */
export async function loadFallbackChainsConfig(): Promise<FallbackChainsConfig> {
  if (cached) return cached;
  const serverUp = await detectConfigServer();
  cached = serverUp ? await fetchFromServer() : readLocalConfig();
  writeLocalConfig(cached);
  return cached;
}

/** Clear cache (tests). */
export function resetFallbackChainsConfigCache(): void {
  cached = null;
}

/** Persist partial fallback chain config via PUT /api/config/meta. */
export async function saveFallbackChainsConfig(
  patch: Partial<FallbackChainsConfig>,
): Promise<void> {
  const current = await loadFallbackChainsConfig();
  const next: FallbackChainsConfig = {
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    cooldownSeconds:
      patch.cooldownSeconds !== undefined
        ? clampCooldown(patch.cooldownSeconds)
        : current.cooldownSeconds,
    maxChainLength:
      patch.maxChainLength !== undefined
        ? clampMaxChainLength(patch.maxChainLength)
        : current.maxChainLength,
    roles: patch.roles ? { ...current.roles, ...patch.roles } : current.roles,
  };
  cached = next;
  writeLocalConfig(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fallbackChains: next }),
  });
}

export { ROLE_KEYS as FALLBACK_ROLE_KEYS };
