/**
 * Resolves effective tool permission for an invocation (patterns → per-agent → default).
 */

import { getToolPermissionForId, isToolPermissionMode, type ToolConfig } from './config';
import type {
  ApprovalPattern,
  ToolAgentKey,
  ToolPermissionMode,
} from './tool-settings-types';

export const MAX_APPROVAL_PATTERNS = 64;

/** Minimal executor context for agent key derivation (matches ExecuteToolContext fields). */
export interface ToolPermissionContext {
  subAgentType?: string;
  workAgentId?: string | null;
}

/** Derives the agent key used for per-agent overrides and pattern scope. */
export function resolveToolAgentKey(context: ToolPermissionContext): ToolAgentKey {
  const sub = context.subAgentType?.trim();
  if (sub) return `sub-agent:${sub}`;
  const work = context.workAgentId?.trim();
  if (work) return `work-agent:${work}`;
  return 'main';
}

/** Reads a nested arg by dot path (shallow segments only). */
export function getArgValueAtPath(
  args: Record<string, unknown>,
  argPath: string,
): string | null {
  const path = argPath.trim();
  if (!path) return null;
  const parts = path.split('.').filter(Boolean);
  let current: unknown = args;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) return null;
  return String(current).trim();
}

function patternMatchesRow(
  pattern: ApprovalPattern,
  toolId: string,
  args: Record<string, unknown>,
  agentKey: ToolAgentKey,
): boolean {
  if (pattern.toolId !== toolId) return false;
  if (pattern.agentScope !== '*' && pattern.agentScope !== agentKey) return false;
  const argValue = getArgValueAtPath(args, pattern.argPath);
  if (argValue === null) return false;
  const needle = pattern.value;
  if (!needle) return false;
  if (pattern.match === 'equals') return argValue === needle;
  return argValue.startsWith(needle);
}

/** Pattern specificity: exact agent scope ranks above "*". */
function patternSortRank(pattern: ApprovalPattern, agentKey: ToolAgentKey): number {
  if (pattern.agentScope === agentKey) return 2;
  if (pattern.agentScope === '*') return 1;
  return 0;
}

/** First matching pattern after sorting by agent specificity. */
export function findMatchingApprovalPattern(
  config: ToolConfig,
  toolId: string,
  args: Record<string, unknown>,
  agentKey: ToolAgentKey,
): ApprovalPattern | null {
  const patterns = config.permissions.patterns;
  if (!patterns.length) return null;

  const candidates = patterns
    .filter((p) => patternSortRank(p, agentKey) > 0)
    .sort((a, b) => patternSortRank(b, agentKey) - patternSortRank(a, agentKey));

  for (const pattern of candidates) {
    if (patternMatchesRow(pattern, toolId, args, agentKey)) return pattern;
  }
  return null;
}

function readPerAgentMode(
  config: ToolConfig,
  agentKey: ToolAgentKey,
  toolId: string,
): ToolPermissionMode | null {
  const scoped = config.permissions.perAgent[agentKey]?.[toolId];
  if (isToolPermissionMode(scoped)) return scoped;
  const wildcard = config.permissions.perAgent['*']?.[toolId];
  if (isToolPermissionMode(wildcard)) return wildcard;
  return null;
}

export interface ResolvedToolPermission {
  mode: ToolPermissionMode;
  matchedPattern: ApprovalPattern | null;
  agentKey: ToolAgentKey;
}

/**
 * Effective permission for one invocation.
 * Global `off` is a hard stop; patterns and per-agent only relax `ask` → `full`.
 */
export function resolveEffectivePermission(
  config: ToolConfig,
  toolId: string,
  args: Record<string, unknown>,
  context: ToolPermissionContext,
): ResolvedToolPermission {
  const agentKey = resolveToolAgentKey(context);
  const defaultMode = getToolPermissionForId(config, toolId);

  if (defaultMode === 'off') {
    return { mode: 'off', matchedPattern: null, agentKey };
  }

  const matchedPattern = findMatchingApprovalPattern(config, toolId, args, agentKey);
  if (matchedPattern) {
    return { mode: 'full', matchedPattern, agentKey };
  }

  const agentMode = readPerAgentMode(config, agentKey, toolId);
  if (agentMode === 'off') {
    return { mode: 'off', matchedPattern: null, agentKey };
  }
  if (agentMode === 'full' || agentMode === 'ask') {
    return { mode: agentMode, matchedPattern: null, agentKey };
  }

  return { mode: defaultMode, matchedPattern: null, agentKey };
}

/** Human-readable label for a matched pattern (settings / approval UI). */
export function formatApprovalPatternLabel(pattern: ApprovalPattern): string {
  return `${pattern.argPath} ${pattern.match} "${pattern.value}"`;
}
