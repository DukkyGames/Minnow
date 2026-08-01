/**
 * Education Mode tool overlay — the single source of truth for what the tutor loses.
 *
 * This is the *exposure* layer: write tools are stripped from the definitions sent
 * to the model, so it never tries and never hits an error loop. Dispatch is guarded
 * separately in education-guard.ts, because sub-agents, board members, and the
 * server runtime can reach a tool without passing through this filter.
 *
 * Every function takes `enabled` as a parameter so the module stays pure and the
 * denied set can be asserted directly in tests.
 */

import type { OpenAIFunctionDefinition, ToolDefinition } from '../../tools/definitions';
import { TOOL_GROUP_IDS } from './tool-groups';
import { isExternalDynamicTool } from './tool-policy';

/**
 * Tools removed when Education Mode is on.
 *
 * - the whole `files-write` group (including `make_directory`)
 * - `update_settings`, so the agent cannot switch Education Mode off from a chat
 * - `run_javascript` / `run_python`, which are "code execution" in name only:
 *   both are one `writeFileSync` away from being a file editor
 *
 * Deliberately kept: `execute_command`, `start_background_command`,
 * `manage_dev_servers`, all of `git-write`, `files-read`, `code-intel`, `lsp`,
 * and `todo_write`. Running the student's tests is the single most valuable
 * teaching tool, and their commits stay their own.
 */
export const EDUCATION_DENIED_TOOL_IDS: ReadonlySet<string> = new Set<string>([
  ...TOOL_GROUP_IDS['files-write'],
  'update_settings',
  'run_javascript',
  'run_python',
]);

/**
 * MCP and plugin tools bypass the mode matrix entirely (see isExternalDynamicTool),
 * so a connected filesystem MCP server is an open write path. Name-matching is the
 * only signal available without a schema convention: best-effort, documented in the
 * settings copy, not a guarantee.
 */
const EXTERNAL_WRITE_NAME_RE = /write|edit|create|save|delete|remove|patch|append|mkdir|rename|move/i;

/** True when an MCP/plugin tool name reads like a mutation. */
export function isExternalWriteToolName(toolName: string): boolean {
  return isExternalDynamicTool(toolName) && EXTERNAL_WRITE_NAME_RE.test(toolName);
}

/** True when Education Mode removes this tool from the model's surface. */
export function isToolBlockedByEducationMode(
  enabled: boolean,
  toolName: string,
): boolean {
  if (!enabled) return false;
  if (EDUCATION_DENIED_TOOL_IDS.has(toolName)) return true;
  return isExternalWriteToolName(toolName);
}

/**
 * Drop denied tools from OpenAI function definitions.
 * Apply LAST in every path that builds a tool list, after mode policy, expert,
 * board-member, and work-agent filters, so nothing re-adds a write tool.
 */
export function applyEducationToolFilter(
  enabled: boolean,
  defs: OpenAIFunctionDefinition[],
): OpenAIFunctionDefinition[] {
  if (!enabled) return defs;
  return defs.filter((def) => !isToolBlockedByEducationMode(true, def.function.name));
}

/** Catalog-entry variant for paths that filter {@link ToolDefinition} before mapping. */
export function applyEducationCatalogFilter(
  enabled: boolean,
  tools: ToolDefinition[],
): ToolDefinition[] {
  if (!enabled) return tools;
  return tools.filter(
    (tool) => !isToolBlockedByEducationMode(true, tool.definition.function.name),
  );
}
