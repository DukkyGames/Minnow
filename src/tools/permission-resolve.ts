import { getToolPermissionForId, type ToolConfig } from './config';
import type { ToolPermissionMode } from './tool-settings-types';

/** Minimal executor context for permission resolution. */
export interface ToolPermissionContext {
  subAgentType?: string;
  workAgentId?: string | null;
  /** Active composer mode (catalog permissions apply uniformly across modes). */
  modeId?: string;
}

export interface ResolvedToolPermission {
  mode: ToolPermissionMode;
}

/**
 * Effective permission for one invocation — reads `permissions.default[toolId]` only.
 */
export function resolveEffectivePermission(
  config: ToolConfig,
  toolId: string,
  _args: Record<string, unknown>,
  _context: ToolPermissionContext,
): ResolvedToolPermission {
  const mode = getToolPermissionForId(config, toolId);
  return { mode };
}
