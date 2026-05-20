/**
 * Persisted tool settings types (shared by config module and defaults consumers).
 */

/** How a tool may run: no prompt, prompt each use, or hidden from the model. */
export type ToolPermissionMode = 'full' | 'ask' | 'off';

/** Persisted tool settings: permissions (source of truth), mirrored `enabled`, and keys. */
export interface ToolConfig {
  /** Mirrored from permissions: true when mode is not `off` (backward-compatible JSON). */
  enabled: Record<string, boolean>;
  /** Per-tool execution policy; may include `mcp__*` ids not in the built-in catalog. */
  permissions: Record<string, ToolPermissionMode>;
  keys: {
    braveApiKey: string;
  };
}
