/**
 * Load and merge sub-agent configuration (defaults + ~/.minnow/sub-agents.json).
 */

import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import { DEFAULT_CONTEXT_ENFORCEMENT_POLICY, type ContextEnforcementPolicy } from '../chat/context-budget';
import { DEFAULT_SUB_AGENT_SUMMARY_SCHEMA } from './sub-agent-structured-outcome';
import DEFAULTS from './defaults/sub-agents.json';
import { clampSamplerPreset, mergeSamplerLayers } from './sampler-types';
import { clampThinkingBudgetTokens } from './thinking-types';
import type { SubAgentTypeConfig, SubAgentsFile } from './types';

const SUB_AGENTS_STORAGE_KEY = 'minnow.subAgents';

/** Shipped default provider before inherit fix — migrate to empty when model is also unset. */
export const LEGACY_SUB_AGENT_DEFAULT_PROVIDER = 'lm-studio-local';

let runtimeUserOverrides: Partial<SubAgentsFile> | null = null;
let cachedMerged: SubAgentsFile | null = null;
let cachedUserOverrides: Partial<SubAgentsFile> | null | undefined;

/** Coerce check-in nudge interval: 0 = disabled, else [10s, 30m]. */
export function clampSubAgentCheckInNudgeMs(value: unknown, fallback = 120_000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded <= 0) return 0;
  return Math.min(1_800_000, Math.max(10_000, rounded));
}

/** Coerce heartbeat interval H; `0` disables periodic ticks. */
export function clampHeartbeatIntervalMs(value: unknown, fallback = 10_000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded <= 0) return 0;
  return rounded;
}

/** Coerce progress stall threshold P; `0` disables stall detection. */
export function clampProgressStallMs(value: unknown, fallback = 300_000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded <= 0) return 0;
  return rounded;
}

/** Coerce heartbeat dead threshold D; `0` disables unresponsive detection. */
export function clampHeartbeatDeadMs(value: unknown, fallback = 90_000): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded <= 0) return 0;
  return rounded;
}

/** Coerce duplicate-tool watchdog threshold; `0` disables detection. */
export function clampDuplicateToolCallThreshold(value: unknown, fallback = 25): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded <= 0) return 0;
  return rounded;
}

function cloneTypeConfig(raw: SubAgentTypeConfig): SubAgentTypeConfig {
  return {
    ...raw,
    allowedTools: raw.allowedTools ? [...raw.allowedTools] : null,
    deniedTools: [...raw.deniedTools],
    sampler: raw.sampler ? { ...raw.sampler } : undefined,
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
    checkInNudgeMs: clampSubAgentCheckInNudgeMs(
      user?.checkInNudgeMs ?? defaults.checkInNudgeMs,
      clampSubAgentCheckInNudgeMs(defaults.checkInNudgeMs),
    ),
    heartbeatIntervalMs: clampHeartbeatIntervalMs(
      user?.heartbeatIntervalMs ?? defaults.heartbeatIntervalMs,
    ),
    progressStallMs: clampProgressStallMs(
      user?.progressStallMs ?? defaults.progressStallMs,
    ),
    heartbeatDeadMs: clampHeartbeatDeadMs(
      user?.heartbeatDeadMs ?? defaults.heartbeatDeadMs,
    ),
    duplicateToolCallThreshold: clampDuplicateToolCallThreshold(
      user?.duplicateToolCallThreshold ?? defaults.duplicateToolCallThreshold,
    ),
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
        providerId: '',
        modelId: '',
        maxConcurrent: 1,
        timeoutMs: merged.defaultTimeoutMs,
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
      const mergedThinkingBudget =
        patch.thinkingBudgetTokens !== undefined
          ? patch.thinkingBudgetTokens === null
            ? null
            : clampThinkingBudgetTokens(patch.thinkingBudgetTokens)
          : existing.thinkingBudgetTokens;
      merged.types[id] = {
        ...existing,
        ...patch,
        thinkingBudgetTokens: mergedThinkingBudget,
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
    cfg.providerId = migrateLegacySubAgentProviderId(cfg.providerId, cfg.modelId);
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

/** Coerce legacy lm-studio-local + empty model rows to inherit parent/global provider. */
export function migrateLegacySubAgentProviderId(
  providerId: string | undefined,
  modelId: string | undefined,
): string {
  const pid = providerId?.trim() ?? '';
  const mid = modelId?.trim() ?? '';
  if (pid === LEGACY_SUB_AGENT_DEFAULT_PROVIDER && !mid) {
    return '';
  }
  return pid;
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
    cachedUserOverrides = undefined;
    return true;
  }

  writeLocalSubAgents(overrides);
  runtimeUserOverrides = overrides;
  cachedMerged = null;
  cachedUserOverrides = undefined;
  return true;
}

/** Set in-memory user overrides (tests). */
export function setRuntimeSubAgentOverrides(overrides: Partial<SubAgentsFile> | null): void {
  runtimeUserOverrides = overrides;
  cachedMerged = null;
  cachedUserOverrides = undefined;
}

/** Reset config cache (tests). */
export function resetSubAgentConfigCache(): void {
  cachedMerged = null;
  runtimeUserOverrides = null;
  cachedUserOverrides = undefined;
}

/** Raw user overrides from the last load (for inherit vs explicit policy). */
export function getSubAgentUserOverridesSync(): Partial<SubAgentsFile> | null {
  return cachedUserOverrides ?? runtimeUserOverrides;
}

/** Global context policy from the merged sub-agents config (sync). */
export function getGlobalContextEnforcementPolicySync(): ContextEnforcementPolicy {
  if (cachedMerged?.defaultContextEnforcementPolicy) {
    return cachedMerged.defaultContextEnforcementPolicy;
  }
  const defaults = DEFAULTS as SubAgentsFile;
  return (
    runtimeUserOverrides?.defaultContextEnforcementPolicy ??
    defaults.defaultContextEnforcementPolicy ??
    DEFAULT_CONTEXT_ENFORCEMENT_POLICY
  );
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

  cachedUserOverrides = user ?? null;
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
