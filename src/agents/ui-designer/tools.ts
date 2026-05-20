/**
 * UI Designer tool allowlist and plan-mode guards (Step 15).
 */

import type { OpenAIFunctionDefinition } from '../../tools/definitions';
import {
  UI_DESIGNER_TOOL_ALLOWLIST,
  UI_DESIGNER_WRITE_TOOLS,
  type UiDesignerMode,
} from './constants';

const ALLOW_SET = new Set<string>(UI_DESIGNER_TOOL_ALLOWLIST);

/** Filter enabled tool definitions to the UI Designer allowlist. */
export function filterToolsForUiDesigner(
  tools: OpenAIFunctionDefinition[],
): OpenAIFunctionDefinition[] {
  return tools.filter((t) => ALLOW_SET.has(t.function.name));
}

/** Whether a tool call is allowed for the current UI Designer mode. */
export function assertUiDesignerToolAllowed(
  toolName: string,
  mode: UiDesignerMode,
): string | null {
  if (mode !== 'plan') return null;
  if (!UI_DESIGNER_WRITE_TOOLS.has(toolName)) return null;
  return 'Error: UI Designer plan mode does not allow file writes';
}
