/**
 * Persisted tool settings types (shared by config module and defaults consumers).
 */

/** How a tool may run: no prompt, prompt each use, or hidden from the model. */
export type ToolPermissionMode = 'full' | 'ask' | 'off';

/** Agent scope for overrides and patterns (e.g. main, work-agent:builder, sub-agent:shell). */
export type ToolAgentKey = string;

/** Argument-pattern row for auto-approve before the global/per-agent mode is applied. */
export interface ApprovalPattern {
  /** Stable id for UI delete. */
  id: string;
  /** Built-in or mcp__ tool id. */
  toolId: string;
  /** Agent key or "*" for all agents. */
  agentScope: ToolAgentKey | '*';
  /** Dot path into args, e.g. "command", "path". */
  argPath: string;
  match: 'startsWith' | 'equals';
  value: string;
}

/** Layered permissions: global default, per-agent overrides, and argument patterns. */
export interface ToolPermissionsConfig {
  /** Former flat map — global default per tool id. */
  default: Record<string, ToolPermissionMode>;
  /** Optional per-agent overrides (sparse). */
  perAgent: Record<ToolAgentKey, Record<string, ToolPermissionMode>>;
  /** Auto-approve rules evaluated before perAgent/default (not when default is off). */
  patterns: ApprovalPattern[];
}

/** Empty layered permissions object (defaults filled by {@link defaultToolConfig}). */
export function createEmptyToolPermissionsConfig(): ToolPermissionsConfig {
  return { default: {}, perAgent: {}, patterns: [] };
}

/** Session tool result cache toggle (runtime-only; not persisted server-side beyond tools.json). */
export interface ToolCacheConfig {
  /** When false, every tool call runs fresh (default true). */
  enabled: boolean;
}

/** Preferred backend for the built-in `web_search` tool. */
export type WebSearchProvider = 'brave' | 'tavily' | 'duckduckgo';

/** Persisted tool settings: permissions (source of truth), mirrored `enabled`, and keys. */
export interface ToolConfig {
  /** Mirrored from permissions.default: true when mode is not `off` (backward-compatible JSON). */
  enabled: Record<string, boolean>;
  /** Per-tool execution policy; may include `mcp__*` ids not in the built-in catalog. */
  permissions: ToolPermissionsConfig;
  keys: {
    braveApiKey: string;
    tavilyApiKey: string;
  };
  /** Preferred web_search backend when credentials and server allow it. */
  webSearchProvider: WebSearchProvider;
  /** Optional session cache for repeated read-only tool invocations. */
  toolCache?: ToolCacheConfig;
}
