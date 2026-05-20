/**
 * Work Agent registry: built-ins from shipped prompts + user overrides.
 */

import { parsePromptMarkdown } from '../chat/prompts/parse-front-matter';
import { parseWorkAgentMetaFromMarkdown } from './work-agent-meta-parse';
import type {
  WorkAgentDefinition,
  WorkAgentUserOverride,
} from './work-agent-types';

const SKIP_PREFIXES = ['_template', '_example'];

/** Default registry order when registry.json is missing (tests). */
export const DEFAULT_REGISTRY_IDS = [
  'default',
  'builder',
  'planner',
  'reviewer',
  'researcher',
  'ui-designer',
] as const;

export interface WorkAgentRegistryIndex {
  ids: string[];
}

let registryIndex: WorkAgentRegistryIndex = { ids: [...DEFAULT_REGISTRY_IDS] };
let builtinAgents = new Map<string, WorkAgentDefinition>();
let userOverrides: Record<string, WorkAgentUserOverride> = {};

function shouldSkipAgentId(id: string): boolean {
  if (!id || id.startsWith('_')) return true;
  return SKIP_PREFIXES.some((p) => id === p || id.startsWith(`${p}/`));
}

function agentIdFromPath(relativePath: string): string | null {
  const norm = relativePath.replace(/\\/g, '/');
  const match = norm.match(/work-agents\/([^/]+)\/agent\.(full|lite)\.md$/);
  return match?.[1] ?? null;
}

interface AgentAccumulator {
  meta?: WorkAgentDefinition;
  fullBody?: string;
  liteBody?: string;
}

function mergeRawFile(
  accMap: Map<string, AgentAccumulator>,
  agentId: string,
  suffix: 'full' | 'lite',
  raw: string,
  relativePath: string,
): void {
  if (shouldSkipAgentId(agentId)) return;

  let acc = accMap.get(agentId);
  if (!acc) {
    acc = {};
    accMap.set(agentId, acc);
  }

  if (suffix === 'full') {
    const meta = parseWorkAgentMetaFromMarkdown(raw, relativePath);
    if (meta) acc.meta = meta;
    try {
      const { markdownBody } = parsePromptMarkdown(raw, relativePath);
      acc.fullBody = markdownBody.trim();
    } catch {
      /* skip */
    }
  } else {
    try {
      const { markdownBody } = parsePromptMarkdown(raw, relativePath);
      acc.liteBody = markdownBody.trim();
    } catch {
      /* skip */
    }
  }
}

function buildAgentsFromRaw(rawMap: Record<string, string>): Map<string, WorkAgentDefinition> {
  const accMap = new Map<string, AgentAccumulator>();

  for (const [globPath, raw] of Object.entries(rawMap)) {
    const relativePath = globPath
      .replace(/^\.\//, '')
      .replace(/^.*?prompts[\\/]/, '');
    if (!relativePath.includes('work-agents/')) continue;

    const agentId = agentIdFromPath(relativePath);
    if (!agentId) continue;

    const suffix = relativePath.endsWith('.lite.md') ? 'lite' : 'full';
    mergeRawFile(accMap, agentId, suffix, raw, relativePath);
  }

  const out = new Map<string, WorkAgentDefinition>();
  for (const [id, acc] of accMap) {
    if (!acc.meta) continue;
    out.set(id, { ...acc.meta });
  }
  return out;
}

/** Merge user override scalars onto a built-in definition. */
export function mergeWorkAgentDefinition(
  builtin: WorkAgentDefinition,
  override: WorkAgentUserOverride | undefined,
): WorkAgentDefinition {
  if (!override) return { ...builtin };

  return {
    ...builtin,
    providerId:
      override.providerId !== undefined ? override.providerId : builtin.providerId,
    modelId: override.modelId !== undefined ? override.modelId : builtin.modelId,
    disabled: override.disabled !== undefined ? override.disabled : builtin.disabled,
  };
}

function orderedAgents(map: Map<string, WorkAgentDefinition>): WorkAgentDefinition[] {
  const seen = new Set<string>();
  const list: WorkAgentDefinition[] = [];

  for (const id of registryIndex.ids) {
    const agent = map.get(id);
    if (agent && !seen.has(id)) {
      list.push(mergeWorkAgentDefinition(agent, userOverrides[id]));
      seen.add(id);
    }
  }

  for (const [id, agent] of map) {
    if (!seen.has(id)) {
      list.push(mergeWorkAgentDefinition(agent, userOverrides[id]));
    }
  }

  return list;
}

/** Set registry.json index (call from init or tests). */
export function setWorkAgentRegistryIndex(index: WorkAgentRegistryIndex): void {
  registryIndex = { ids: [...index.ids] };
}

/** Replace user overrides map (from API or tests). */
export function setUserWorkAgentOverrides(
  overrides: Record<string, WorkAgentUserOverride>,
): void {
  userOverrides = { ...overrides };
}

/** Load built-in agents from Vite glob or test fixture map. */
export function initBuiltinWorkAgentRegistry(raw: Record<string, string> = {}): void {
  builtinAgents = buildAgentsFromRaw(raw);
}

/** Register additional agent files (tests). */
export function registerWorkAgentFilesFromRaw(rawMap: Record<string, string>): void {
  const built = buildAgentsFromRaw(rawMap);
  for (const [id, agent] of built) {
    builtinAgents.set(id, agent);
  }
}

export function resetWorkAgentRegistry(): void {
  builtinAgents.clear();
  userOverrides = {};
  registryIndex = { ids: [...DEFAULT_REGISTRY_IDS] };
}

/** List all work agents in registry order (merged overrides). */
export function listWorkAgents(includeDisabled = false): WorkAgentDefinition[] {
  const agents = orderedAgents(builtinAgents);
  if (includeDisabled) return agents;
  return agents.filter((a) => !a.disabled);
}

/** Get one agent by id (null if missing). */
export function getWorkAgent(id: string): WorkAgentDefinition | null {
  const agent = builtinAgents.get(id);
  if (!agent) return null;
  return mergeWorkAgentDefinition(agent, userOverrides[id]);
}

/** First agent whose defaultForModes includes modeId. */
export function getDefaultWorkAgentForMode(modeId: string): WorkAgentDefinition | null {
  const mode = modeId.trim();
  if (!mode) return null;

  for (const id of registryIndex.ids) {
    const agent = getWorkAgent(id);
    if (!agent || agent.disabled || agent.id === 'default') continue;
    if (agent.defaultForModes?.includes(mode)) return agent;
  }

  return null;
}

/** User override row for an agent id. */
export function getUserWorkAgentOverride(agentId: string): WorkAgentUserOverride | undefined {
  return userOverrides[agentId];
}

/** Effective prompt override string for an agent (user JSON field). */
export function getWorkAgentPromptOverride(agentId: string): string | null {
  const override = userOverrides[agentId]?.promptOverride;
  if (typeof override === 'string' && override.trim()) return override.trim();
  return null;
}
