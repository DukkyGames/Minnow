/**
 * Load and merge `supervisor` config from `config.json` with legacy `selfHealing` migration.
 */

import { DEFAULT_SUPERVISOR_CONFIG, type SupervisorConfig } from './defaults.ts';

let snapshot: SupervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG, repetition: { ...DEFAULT_SUPERVISOR_CONFIG.repetition } };
let lastFetchAt = 0;
const CACHE_MS = 30_000;

function cloneConfig(base: SupervisorConfig): SupervisorConfig {
  return {
    ...base,
    repetition: { ...base.repetition },
  };
}

/** Synchronous read of the last merged supervisor row (defaults before first fetch). */
export function getSupervisorConfigSnapshot(): SupervisorConfig {
  return cloneConfig(snapshot);
}

function mergeLegacySelfHealing(
  row: Record<string, unknown> | undefined,
  out: SupervisorConfig,
): void {
  if (!row || typeof row !== 'object') return;
  const sh = row as {
    enabled?: boolean;
    tier1?: {
      duplicateToolCallThreshold?: number;
      sameErrorThreshold?: number;
      maxRestartsPerParentTurn?: number;
    };
  };
  if (typeof sh.enabled === 'boolean') {
    out.repetitionDetection = sh.enabled;
  }
  if (sh.tier1 && typeof sh.tier1 === 'object') {
    if (typeof sh.tier1.duplicateToolCallThreshold === 'number') {
      out.repetition.duplicateToolCallThreshold = sh.tier1.duplicateToolCallThreshold;
    }
    if (typeof sh.tier1.sameErrorThreshold === 'number') {
      out.repetition.sameErrorThreshold = sh.tier1.sameErrorThreshold;
    }
    if (typeof sh.tier1.maxRestartsPerParentTurn === 'number') {
      out.repetition.maxRestartsPerRun = sh.tier1.maxRestartsPerParentTurn;
    }
  }
}

function mergeSupervisorPatch(raw: unknown, base: SupervisorConfig): SupervisorConfig {
  const out = cloneConfig(base);
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as Record<string, unknown>;

  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (typeof p.autoResume === 'boolean') out.autoResume = p.autoResume;
  if (typeof p.repetitionDetection === 'boolean') out.repetitionDetection = p.repetitionDetection;
  if (typeof p.llmEscalation === 'boolean') out.llmEscalation = p.llmEscalation;
  if (typeof p.askUserOnBudgetExhausted === 'boolean') {
    out.askUserOnBudgetExhausted = p.askUserOnBudgetExhausted;
  }
  if (typeof p.stallMs === 'number' && Number.isFinite(p.stallMs)) out.stallMs = p.stallMs;
  if (typeof p.maxRetriesPerTask === 'number' && Number.isFinite(p.maxRetriesPerTask)) {
    out.maxRetriesPerTask = p.maxRetriesPerTask;
  }
  if (typeof p.orchestratorHeartbeatMs === 'number' && Number.isFinite(p.orchestratorHeartbeatMs)) {
    out.orchestratorHeartbeatMs = p.orchestratorHeartbeatMs;
  }
  if (typeof p.inProgressNoRunMs === 'number' && Number.isFinite(p.inProgressNoRunMs)) {
    out.inProgressNoRunMs = p.inProgressNoRunMs;
  }
  if (typeof p.spawnStuckMs === 'number' && Number.isFinite(p.spawnStuckMs)) {
    out.spawnStuckMs = p.spawnStuckMs;
  }
  if (typeof p.parentSilenceAfterToolMs === 'number' && Number.isFinite(p.parentSilenceAfterToolMs)) {
    out.parentSilenceAfterToolMs = p.parentSilenceAfterToolMs;
  }
  if (typeof p.subAgentToolSilenceMs === 'number' && Number.isFinite(p.subAgentToolSilenceMs)) {
    out.subAgentToolSilenceMs = p.subAgentToolSilenceMs;
  }
  if (typeof p.runRestartCap === 'number' && Number.isFinite(p.runRestartCap)) {
    out.runRestartCap = p.runRestartCap;
  }
  if (typeof p.spawnCapPerTask === 'number' && Number.isFinite(p.spawnCapPerTask)) {
    out.spawnCapPerTask = p.spawnCapPerTask;
  }
  if (typeof p.llmEscalationsPerSession === 'number' && Number.isFinite(p.llmEscalationsPerSession)) {
    out.llmEscalationsPerSession = p.llmEscalationsPerSession;
  }
  if (typeof p.llmEscalationTimeoutMs === 'number' && Number.isFinite(p.llmEscalationTimeoutMs)) {
    out.llmEscalationTimeoutMs = p.llmEscalationTimeoutMs;
  }
  if (typeof p.tickIntervalMs === 'number' && Number.isFinite(p.tickIntervalMs)) {
    out.tickIntervalMs = p.tickIntervalMs;
  }
  if (typeof p.escalationProviderId === 'string') out.escalationProviderId = p.escalationProviderId;
  if (typeof p.escalationModelId === 'string') out.escalationModelId = p.escalationModelId;

  const rep = p.repetition;
  if (rep && typeof rep === 'object') {
    const r = rep as Record<string, unknown>;
    if (typeof r.duplicateToolCallThreshold === 'number') {
      out.repetition.duplicateToolCallThreshold = r.duplicateToolCallThreshold;
    }
    if (typeof r.sameErrorThreshold === 'number') {
      out.repetition.sameErrorThreshold = r.sameErrorThreshold;
    }
    if (typeof r.maxRestartsPerRun === 'number') {
      out.repetition.maxRestartsPerRun = r.maxRestartsPerRun;
    }
  }

  return out;
}

/**
 * Fetch `config.json`, merge `supervisor` with defaults and optional legacy `selfHealing`.
 */
export async function loadSupervisorConfig(force = false): Promise<SupervisorConfig> {
  const now = Date.now();
  if (!force && now - lastFetchAt < CACHE_MS) {
    return cloneConfig(snapshot);
  }

  let next = cloneConfig(DEFAULT_SUPERVISOR_CONFIG);
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      if (body.supervisor && typeof body.supervisor === 'object') {
        next = mergeSupervisorPatch(body.supervisor, next);
      } else {
        mergeLegacySelfHealing(body.selfHealing as Record<string, unknown> | undefined, next);
      }
    }
  } catch {
    /* offline — keep snapshot */
  }

  snapshot = next;
  lastFetchAt = now;
  return cloneConfig(snapshot);
}

/** After settings save, force the next tick to pick up fresh numbers. */
export function invalidateSupervisorConfigCache(): void {
  lastFetchAt = 0;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastFetchAt = 0;
    }
  });
}
