/**
 * Resolve merged sampler presets for work agents and sub-agent types at send time.
 */

import WORK_AGENT_SAMPLER_DEFAULTS from './defaults/work-agent-samplers.json';
import SUB_AGENT_DEFAULTS from './defaults/sub-agents.json';
import { isPassthroughWorkAgentId } from './resolve-work-agent';
import { getUserWorkAgentOverride } from './work-agent-registry';
import {
  clampSamplerPreset,
  mergeSamplerLayers,
  type SamplerPreset,
} from './sampler-types';
import type { GlobalSamplerForSend } from '../config/sampler-meta';
import type { SubAgentTypeConfig } from './types';

export type SamplerResolveKind = 'work-agent' | 'sub-agent';

export interface ResolveSamplerInput {
  /** Work agent id or sub-agent type id; null for passthrough main chat. */
  agentKey: string | null;
  kind: SamplerResolveKind;
  /** Main chat: persisted global defaults (+ optional drawer overrides for temp/max). */
  global: GlobalSamplerForSend;
  /** Sub-agent runs: legacy max token hint when type omits maxTokens. */
  subAgentMaxTokensFallback?: number;
  /** Sub-agent merged type row (includes shipped + user sampler). */
  subAgentType?: SubAgentTypeConfig | null;
}

export interface ResolvedSampler {
  preset: SamplerPreset;
  maxTokens: number;
}

const DEFAULT_SUB_AGENT_MAX_TOKENS = 2048;

function builtinWorkAgentSampler(agentId: string): SamplerPreset {
  const map = WORK_AGENT_SAMPLER_DEFAULTS as Record<string, SamplerPreset>;
  return map[agentId] ? { ...map[agentId] } : {};
}

function builtinSubAgentSampler(typeId: string): SamplerPreset {
  const types = SUB_AGENT_DEFAULTS.types as Record<string, SubAgentTypeConfig>;
  const row = types[typeId];
  return row?.sampler ? { ...row.sampler } : {};
}

function globalLayer(input: ResolveSamplerInput): SamplerPreset {
  return { ...input.global.preset };
}

function userWorkAgentSampler(agentId: string | null): SamplerPreset {
  if (!agentId) return {};
  const override = getUserWorkAgentOverride(agentId)?.sampler;
  return override ? { ...override } : {};
}

/**
 * Merge global drawer → role defaults → user overrides (main chat);
 * sub-agents use shipped + merged type config only (no drawer temperature).
 */
export function resolveSamplerPreset(input: ResolveSamplerInput): ResolvedSampler {
  let merged: SamplerPreset;

  if (input.kind === 'sub-agent') {
    const key = input.agentKey;
    const typeSampler =
      input.subAgentType?.sampler ??
      (key ? builtinSubAgentSampler(key) : {});
    merged = clampSamplerPreset(typeSampler);
  } else {
    const key = input.agentKey;
    const global = globalLayer(input);
    let roleDefault: SamplerPreset = {};
    if (key && !isPassthroughWorkAgentId(key)) {
      roleDefault = builtinWorkAgentSampler(key);
    }
    const userOverride = userWorkAgentSampler(key ?? 'default');
    merged = clampSamplerPreset(
      mergeSamplerLayers(global, roleDefault, userOverride),
    );
  }

  let maxTokens =
    input.kind === 'sub-agent'
      ? merged.maxTokens ??
        input.subAgentMaxTokensFallback ??
        DEFAULT_SUB_AGENT_MAX_TOKENS
      : input.global.maxTokens;
  if (!Number.isFinite(maxTokens) || maxTokens < 1) {
    maxTokens =
      input.kind === 'sub-agent' ? DEFAULT_SUB_AGENT_MAX_TOKENS : 64000;
  }

  const { maxTokens: _drop, ...preset } = merged;
  return { preset, maxTokens: Math.floor(maxTokens) };
}
