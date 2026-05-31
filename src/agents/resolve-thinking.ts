/**
 * Resolve merged thinking mode for work agents and sub-agents at send time.
 */

import WORK_AGENT_THINKING_DEFAULTS from './defaults/work-agent-thinking.json';
import SUB_AGENT_DEFAULTS from './defaults/sub-agents.json';
import { getThinkingMetaSync } from '../config/thinking-meta';
import { isPassthroughWorkAgentId } from './resolve-work-agent';
import { getUserWorkAgentOverride } from './work-agent-registry';
import {
  mergeThinkingTriState,
  normalizeThinkingTriState,
  type ThinkingResolvedMode,
  type ThinkingTriState,
} from './thinking-types';
import type { SubAgentTypeConfig } from './types';

export type ThinkingResolveKind = 'work-agent' | 'sub-agent';

export interface ResolveThinkingInput {
  kind: ThinkingResolveKind;
  /** Work agent id or sub-agent type id. */
  agentKey: string | null;
  /** Chat override; explicit on/off wins for main + sub-agents when set. */
  chatThinkingMode?: ThinkingTriState | null;
  /** Sub-agent merged type row. */
  subAgentType?: SubAgentTypeConfig | null;
}

export interface ResolvedThinking {
  mode: ThinkingResolvedMode;
  /** Label source for composer inherit hint. */
  sourceLabel: string;
}

function builtinWorkAgentThinking(agentId: string): ThinkingTriState {
  const map = WORK_AGENT_THINKING_DEFAULTS as Record<string, ThinkingTriState>;
  return normalizeThinkingTriState(map[agentId], 'inherit');
}

function builtinSubAgentThinking(typeId: string): ThinkingTriState {
  const types = SUB_AGENT_DEFAULTS.types as Record<string, SubAgentTypeConfig>;
  const row = types[typeId];
  return normalizeThinkingTriState(row?.thinkingMode, 'inherit');
}

function userWorkAgentThinking(agentId: string | null): ThinkingTriState {
  if (!agentId) return 'inherit';
  const override = getUserWorkAgentOverride(agentId)?.thinkingMode;
  return normalizeThinkingTriState(override, 'inherit');
}

function globalDefault(): ThinkingResolvedMode {
  return getThinkingMetaSync().defaultMode;
}

function sourceForWorkAgent(agentKey: string | null): string {
  if (!agentKey || isPassthroughWorkAgentId(agentKey)) return 'global default';
  const user = getUserWorkAgentOverride(agentKey)?.thinkingMode;
  if (user === 'on' || user === 'off') return `work agent (${agentKey})`;
  const builtin = builtinWorkAgentThinking(agentKey);
  if (builtin === 'on' || builtin === 'off') return `work agent (${agentKey})`;
  return 'global default';
}

function sourceForSubAgent(agentKey: string | null, subAgentType?: SubAgentTypeConfig | null): string {
  const key = agentKey ?? 'sub-agent';
  const typeMode = normalizeThinkingTriState(subAgentType?.thinkingMode, 'inherit');
  if (typeMode === 'on' || typeMode === 'off') return `sub-agent (${key})`;
  const builtin = agentKey ? builtinSubAgentThinking(agentKey) : 'inherit';
  if (builtin === 'on' || builtin === 'off') return `sub-agent (${key})`;
  return 'global default';
}

/**
 * Resolve thinking for main chat or sub-agent completions.
 * Parent chat on/off overrides sub-agent type when chatThinkingMode is explicit.
 */
export function resolveThinkingMode(input: ResolveThinkingInput): ResolvedThinking {
  const chatMode = normalizeThinkingTriState(input.chatThinkingMode, 'inherit');
  if (chatMode === 'on' || chatMode === 'off') {
    return {
      mode: chatMode,
      sourceLabel: 'chat',
    };
  }

  const global = globalDefault();

  if (input.kind === 'sub-agent') {
    const key = input.agentKey;
    const typeMode =
      input.subAgentType?.thinkingMode ??
      (key ? builtinSubAgentThinking(key) : 'inherit');
    const mode = mergeThinkingTriState(global, typeMode);
    return {
      mode,
      sourceLabel: sourceForSubAgent(key, input.subAgentType),
    };
  }

  const key = input.agentKey;
  let roleDefault: ThinkingTriState = 'inherit';
  if (key && !isPassthroughWorkAgentId(key)) {
    roleDefault = builtinWorkAgentThinking(key);
  }
  const userOverride = userWorkAgentThinking(key ?? 'default');
  const mode = mergeThinkingTriState(global, roleDefault, userOverride);
  return {
    mode,
    sourceLabel: sourceForWorkAgent(key),
  };
}
