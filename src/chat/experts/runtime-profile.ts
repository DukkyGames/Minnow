/**
 * Expert runtime profile normalization and chat seed resolution.
 */

import { normalizeModeId, type ModeId } from '../modes/types';
import type {
  ExpertRuntimeProfile,
  ExpertRuntimeSnapshot,
  ExpertsConfig,
} from './types';
import { getExpert } from './registry';
import { resolveAuthoredGreeting } from './greet';

const MAX_TOOL_LIST = 128;
const MAX_TOOL_ID_LEN = 128;
const MAX_PROFILE_ID_LEN = 64;

/** Normalize a single persisted expert runtime profile. */
export function normalizeExpertRuntimeProfile(raw: unknown): ExpertRuntimeProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const out: ExpertRuntimeProfile = {};

  if (typeof row.providerId === 'string' && row.providerId.trim()) {
    out.providerId = row.providerId.trim().slice(0, MAX_PROFILE_ID_LEN);
  }
  if (typeof row.modelId === 'string' && row.modelId.trim()) {
    out.modelId = row.modelId.trim().slice(0, MAX_PROFILE_ID_LEN);
  }
  if (typeof row.modeId === 'string' && row.modeId.trim()) {
    const modeId = normalizeModeId(row.modeId);
    if (modeId) out.modeId = modeId;
  }
  const allow = normalizeToolIdList(row.toolAllowlist);
  if (allow.length) out.toolAllowlist = allow;
  const deny = normalizeToolIdList(row.toolDenylist);
  if (deny.length) out.toolDenylist = deny;
  if (row.memoryEnabled === false) out.memoryEnabled = false;
  else if (row.memoryEnabled === true) out.memoryEnabled = true;

  if (
    !out.providerId &&
    !out.modelId &&
    !out.modeId &&
    !out.toolAllowlist &&
    !out.toolDenylist &&
    out.memoryEnabled === undefined
  ) {
    return null;
  }
  return out;
}

function normalizeToolIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim().slice(0, MAX_TOOL_ID_LEN);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_TOOL_LIST) break;
  }
  return out;
}

/** Normalize experts config block including per-expert profiles. */
export function normalizeExpertsConfig(raw: unknown): ExpertsConfig {
  if (!raw || typeof raw !== 'object') {
    return { enabled: true, profiles: {} };
  }
  const row = raw as Record<string, unknown>;
  const profiles: Record<string, ExpertRuntimeProfile> = {};
  if (row.profiles && typeof row.profiles === 'object') {
    for (const [key, value] of Object.entries(row.profiles as Record<string, unknown>)) {
      const id = key.trim().slice(0, MAX_PROFILE_ID_LEN);
      if (!id) continue;
      const profile = normalizeExpertRuntimeProfile(value);
      if (profile) profiles[id] = profile;
    }
  }
  return {
    enabled: row.enabled !== false,
    profiles,
  };
}

export interface ExpertChatSeedSource {
  providerId?: string;
  modelId: string;
  modeId: ModeId;
  workspacePath: string;
}

export interface ExpertSeedValidationContext {
  /** Known mode ids (built-in registry). */
  availableModeIds: ReadonlySet<string>;
  /** Composite keys `providerId:modelId` and bare modelId entries. */
  availableModelKeys: ReadonlySet<string>;
  /** Resolve mode-allowed tool names for a given mode id. */
  resolveModeToolNames: (modeId: ModeId) => readonly string[];
}

export interface ExpertChatSeed {
  expertId: string;
  providerId?: string;
  modelId: string;
  modeId: ModeId;
  workspacePath: string;
  greeting: string;
  runtimeSnapshot: ExpertRuntimeSnapshot;
}

function modelKey(providerId: string | undefined, modelId: string): string {
  const mid = modelId.trim();
  const pid = providerId?.trim();
  return pid ? `${pid}:${mid}` : mid;
}

function isModelAvailable(
  ctx: ExpertSeedValidationContext,
  providerId: string | undefined,
  modelId: string,
): boolean {
  const mid = modelId.trim();
  if (!mid) return false;
  if (ctx.availableModelKeys.has(mid)) return true;
  const key = modelKey(providerId, mid);
  return ctx.availableModelKeys.has(key);
}

/** Apply expert allow/deny policy on top of mode-filtered tool names. */
export function resolveExpertToolNames(
  modeToolNames: readonly string[],
  profile: ExpertRuntimeProfile | null | undefined,
): { enabledToolNames: string[]; toolAllowlist: string[] | null; toolDenylist: string[] } {
  const deny = new Set(profile?.toolDenylist ?? []);
  const allowRaw = profile?.toolAllowlist;
  const allow = allowRaw?.length ? new Set(allowRaw) : null;

  let names = modeToolNames.filter((n) => !deny.has(n));
  if (allow) {
    names = names.filter((n) => allow.has(n));
  }
  return {
    enabledToolNames: names,
    toolAllowlist: allowRaw?.length ? [...allowRaw] : null,
    toolDenylist: profile?.toolDenylist ?? [],
  };
}

/**
 * Merge source-chat settings with per-expert profile overrides.
 * Pure — callers supply validation context from live catalog state.
 */
export function resolveExpertChatSeed(
  expertId: string,
  source: ExpertChatSeedSource,
  expertsConfig: ExpertsConfig,
  validation: ExpertSeedValidationContext,
): ExpertChatSeed | { error: string } {
  const trimmedId = expertId.trim();
  if (!trimmedId) return { error: 'Expert id is required.' };

  const expert = getExpert(trimmedId);
  if (!expert) return { error: `Expert "${trimmedId}" was not found.` };

  const profile = expertsConfig.profiles[trimmedId] ?? null;
  const warnings: string[] = [];
  const hasProfileOverride = Boolean(
    profile &&
      (profile.providerId ||
        profile.modelId ||
        profile.modeId ||
        profile.toolAllowlist?.length ||
        profile.toolDenylist?.length ||
        profile.memoryEnabled !== undefined),
  );

  let providerId = source.providerId?.trim() || undefined;
  let modelId = source.modelId.trim();
  let modeId = normalizeModeId(source.modeId);

  if (!modelId) {
    warnings.push('Source chat had no model; using empty model binding.');
  }

  if (profile?.providerId?.trim() || profile?.modelId?.trim()) {
    const overrideProvider = profile.providerId?.trim() || providerId;
    const overrideModel = profile.modelId?.trim() || modelId;
    if (overrideModel && isModelAvailable(validation, overrideProvider, overrideModel)) {
      providerId = overrideProvider;
      modelId = overrideModel;
    } else if (profile.modelId?.trim()) {
      warnings.push(
        `Expert model override "${profile.modelId}" is unavailable; using inherited binding.`,
      );
    }
  }

  if (profile?.modeId) {
    const candidate = normalizeModeId(profile.modeId);
    if (validation.availableModeIds.has(candidate)) {
      modeId = candidate;
    } else {
      warnings.push(`Expert mode override "${profile.modeId}" is invalid; using inherited mode.`);
    }
  }

  const modeTools = validation.resolveModeToolNames(modeId);
  const toolPolicy = resolveExpertToolNames(modeTools, profile);
  const memoryEnabled = profile?.memoryEnabled !== false;

  const greeting = resolveAuthoredGreeting(expert.meta);

  const runtimeSnapshot: ExpertRuntimeSnapshot = {
    providerId,
    modelId,
    modeId,
    toolAllowlist: toolPolicy.toolAllowlist,
    toolDenylist: toolPolicy.toolDenylist,
    enabledToolNames: toolPolicy.enabledToolNames,
    memoryEnabled,
    warnings,
    profileSource: hasProfileOverride ? 'override' : 'inherit',
  };

  return {
    expertId: trimmedId,
    providerId,
    modelId,
    modeId,
    workspacePath: source.workspacePath,
    greeting,
    runtimeSnapshot,
  };
}
