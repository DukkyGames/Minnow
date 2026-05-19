/**
 * Load and merge sub-agent configuration (defaults + ~/.speedchat/sub-agents.json).
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import DEFAULTS from './defaults/sub-agents.json';
import type { SubAgentTypeConfig, SubAgentsFile } from './types';

const SUB_AGENTS_STORAGE_KEY = 'speedchat.subAgents';

let runtimeUserOverrides: Partial<SubAgentsFile> | null = null;
let cachedMerged: SubAgentsFile | null = null;

function cloneTypeConfig(raw: SubAgentTypeConfig): SubAgentTypeConfig {
  return {
    ...raw,
    allowedTools: raw.allowedTools ? [...raw.allowedTools] : null,
    deniedTools: [...raw.deniedTools],
  };
}

/** Deep-merge type maps: user overrides win per field. */
export function mergeSubAgentConfig(
  defaults: SubAgentsFile,
  user: Partial<SubAgentsFile> | null | undefined,
): SubAgentsFile {
  const baseTypes: Record<string, SubAgentTypeConfig> = {};
  for (const [id, cfg] of Object.entries(defaults.types)) {
    baseTypes[id] = cloneTypeConfig(cfg);
  }

  const merged: SubAgentsFile = {
    version: user?.version ?? defaults.version,
    enabled: user?.enabled ?? defaults.enabled,
    globalMaxConcurrent: user?.globalMaxConcurrent ?? defaults.globalMaxConcurrent,
    defaultTimeoutMs: user?.defaultTimeoutMs ?? defaults.defaultTimeoutMs,
    types: baseTypes,
  };

  if (user?.types) {
    for (const [id, patch] of Object.entries(user.types)) {
      const existing = merged.types[id] ?? {
        enabled: true,
        providerId: 'lm-studio-local',
        modelId: '',
        maxConcurrent: 1,
        timeoutMs: merged.defaultTimeoutMs,
        workAgentId: null,
        allowedTools: null,
        deniedTools: ['spawn_sub_agent', 'cancel_sub_agent'],
        systemPromptPath: null,
      };
      merged.types[id] = {
        ...existing,
        ...patch,
        allowedTools:
          patch.allowedTools !== undefined
            ? patch.allowedTools
              ? [...patch.allowedTools]
              : null
            : existing.allowedTools,
        deniedTools: patch.deniedTools
          ? [...patch.deniedTools]
          : [...existing.deniedTools],
      };
    }
  }

  return merged;
}

function readLocalSubAgents(): Partial<SubAgentsFile> | null {
  try {
    const raw = localStorage.getItem(SUB_AGENTS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<SubAgentsFile>;
  } catch {
    return null;
  }
}

function writeLocalSubAgents(data: Partial<SubAgentsFile>): void {
  localStorage.setItem(SUB_AGENTS_STORAGE_KEY, JSON.stringify(data));
}

/** Fetch user overrides from the config API when npm start is up. */
export async function fetchSubAgentConfigFromServer(): Promise<Partial<SubAgentsFile> | null> {
  await detectConfigServer();
  if (!isServerStorageMode()) return null;

  try {
    const res = await fetch('/api/config/sub-agents', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as Partial<SubAgentsFile>;
  } catch {
    return null;
  }
}

/** Persist user overrides to server or localStorage mirror. */
export async function saveSubAgentConfigToServer(
  overrides: Partial<SubAgentsFile>,
): Promise<boolean> {
  await detectConfigServer();
  if (isServerStorageMode()) {
    const res = await fetch('/api/config/sub-agents', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides),
    });
    if (!res.ok) return false;
    runtimeUserOverrides = overrides;
    cachedMerged = null;
    return true;
  }

  writeLocalSubAgents(overrides);
  runtimeUserOverrides = overrides;
  cachedMerged = null;
  return true;
}

/** Set in-memory user overrides (tests). */
export function setRuntimeSubAgentOverrides(overrides: Partial<SubAgentsFile> | null): void {
  runtimeUserOverrides = overrides;
  cachedMerged = null;
}

/** Reset config cache (tests). */
export function resetSubAgentConfigCache(): void {
  cachedMerged = null;
  runtimeUserOverrides = null;
}

/**
 * Load merged sub-agent config: shipped defaults ← file/API ← runtime cache.
 */
export async function loadSubAgentConfig(): Promise<SubAgentsFile> {
  if (cachedMerged) return cachedMerged;

  const defaults = DEFAULTS as SubAgentsFile;
  let user: Partial<SubAgentsFile> | null = runtimeUserOverrides;

  if (!user) {
    const fromServer = await fetchSubAgentConfigFromServer();
    user = fromServer ?? readLocalSubAgents();
  }

  cachedMerged = mergeSubAgentConfig(defaults, user ?? undefined);
  return cachedMerged;
}

/** Lookup a type config; null when unknown. */
export async function getSubAgentTypeConfig(
  typeId: string,
): Promise<SubAgentTypeConfig | null> {
  const config = await loadSubAgentConfig();
  const type = config.types[typeId];
  if (!type || type.enabled === false) return null;
  return type;
}
