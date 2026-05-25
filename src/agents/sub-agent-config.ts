/**
 * Load and merge sub-agent configuration (defaults + ~/.minnow/sub-agents.json).
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import { DEFAULT_CONTEXT_ENFORCEMENT_POLICY } from '../chat/context-budget';
import { DEFAULT_SUB_AGENT_SUMMARY_SCHEMA } from './sub-agent-structured-outcome';
import DEFAULTS from './defaults/sub-agents.json';
import { clampSamplerPreset, mergeSamplerLayers } from './sampler-types';
import type { SubAgentTypeConfig, SubAgentsFile } from './types';

const SUB_AGENTS_STORAGE_KEY = 'minnow.subAgents';

/** Fallback when sub-agents config omits `maxToolTurns`. */
export const DEFAULT_SUB_AGENT_MAX_TOOL_TURNS = 12;

let runtimeUserOverrides: Partial<SubAgentsFile> | null = null;
let cachedMerged: SubAgentsFile | null = null;

/** Coerce sub-agent max tool turns to [1, 64]. */
export function clampSubAgentMaxToolTurns(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SUB_AGENT_MAX_TOOL_TURNS;
  return Math.min(64, Math.max(1, Math.round(n)));
}

/** Resolve global sub-agent tool-turn cap from merged or partial config. */
export function getSubAgentsMaxToolTurns(
  file: Pick<SubAgentsFile, 'maxToolTurns' | 'defaultMaxToolTurns'>,
): number {
  const raw = file.maxToolTurns ?? file.defaultMaxToolTurns;
  return clampSubAgentMaxToolTurns(raw);
}

function cloneTypeConfig(raw: SubAgentTypeConfig): SubAgentTypeConfig {
  return {
    ...raw,
    allowedTools: raw.allowedTools ? [...raw.allowedTools] : null,
    deniedTools: [...raw.deniedTools],
    sampler: raw.sampler ? { ...raw.sampler } : undefined,
  };
}

/** Deep-merge type maps: user overrides win per field (except `maxToolTurns`, which is global). */
export function mergeSubAgentConfig(
  defaults: SubAgentsFile,
  user: Partial<SubAgentsFile> | null | undefined,
): SubAgentsFile {
  const baseTypes: Record<string, SubAgentTypeConfig> = {};
  for (const [id, cfg] of Object.entries(defaults.types)) {
    baseTypes[id] = cloneTypeConfig(cfg);
  }

  const maxToolTurns = clampSubAgentMaxToolTurns(
    user?.maxToolTurns ??
      user?.defaultMaxToolTurns ??
      defaults.maxToolTurns ??
      defaults.defaultMaxToolTurns,
  );

  const merged: SubAgentsFile = {
    version: user?.version ?? defaults.version,
    enabled: user?.enabled ?? defaults.enabled,
    globalMaxConcurrent: user?.globalMaxConcurrent ?? defaults.globalMaxConcurrent,
    defaultTimeoutMs: user?.defaultTimeoutMs ?? defaults.defaultTimeoutMs,
    maxToolTurns,
    defaultMaxInputTokens: user?.defaultMaxInputTokens ?? defaults.defaultMaxInputTokens,
    defaultContextEnforcementPolicy:
      user?.defaultContextEnforcementPolicy ??
      defaults.defaultContextEnforcementPolicy ??
      DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
    defaultSummarySchema:
      user?.defaultSummarySchema ?? defaults.defaultSummarySchema ?? DEFAULT_SUB_AGENT_SUMMARY_SCHEMA,
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
        maxToolTurns,
        workAgentId: null,
        allowedTools: null,
        deniedTools: ['spawn_sub_agent', 'cancel_sub_agent'],
        systemPromptPath: null,
      };
      const mergedSampler =
        patch.sampler !== undefined
          ? clampSamplerPreset(
              mergeSamplerLayers(existing.sampler, patch.sampler),
            )
          : existing.sampler;
      const { maxToolTurns: _ignoredTurns, ...patchWithoutTurns } = patch;
      merged.types[id] = {
        ...existing,
        ...patchWithoutTurns,
        maxToolTurns,
        summarySchema:
          patch.summarySchema ??
          existing.summarySchema ??
          merged.defaultSummarySchema ??
          DEFAULT_SUB_AGENT_SUMMARY_SCHEMA,
        allowedTools:
          patch.allowedTools !== undefined
            ? patch.allowedTools
              ? [...patch.allowedTools]
              : null
            : existing.allowedTools,
        deniedTools: patch.deniedTools
          ? [...patch.deniedTools]
          : [...existing.deniedTools],
        sampler: mergedSampler,
      };
    }
  }

  for (const cfg of Object.values(merged.types)) {
    cfg.maxToolTurns = maxToolTurns;
    if (!cfg.summarySchema?.trim()) {
      cfg.summarySchema = merged.defaultSummarySchema ?? DEFAULT_SUB_AGENT_SUMMARY_SCHEMA;
    }
    if (cfg.maxInputTokens != null) {
      const cap = Math.floor(Number(cfg.maxInputTokens));
      cfg.maxInputTokens = Number.isFinite(cap) && cap >= 1000 ? Math.min(cap, 200_000) : null;
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
