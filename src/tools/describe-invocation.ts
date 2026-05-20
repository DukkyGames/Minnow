/**
 * Human-readable summaries of tool invocations for the approval modal.
 */

import { BUILT_IN_TOOLS } from './definitions';

const MAX_ARG_JSON = 1200;

/** Structured copy for the tool approval dialog (no duplicate tool id lines). */
export interface ToolInvocationSummary {
  /** Catalog label, e.g. "List directory". */
  title: string;
  /** Function id passed to the API, e.g. "list_directory". */
  toolId: string;
  /** One-line catalog description when available. */
  description?: string;
  /** Pretty-printed JSON for the arguments block. */
  argsJson: string;
}

/** Build title, optional description, and JSON args for the approval dialog. */
export function describeToolInvocation(
  toolName: string,
  args: Record<string, unknown>,
): ToolInvocationSummary {
  const entry = BUILT_IN_TOOLS.find((t) => t.id === toolName);
  const title = entry?.label ?? toolName;
  const description = entry?.description;
  let argsJson: string;
  try {
    const json = JSON.stringify(args, null, 2);
    argsJson =
      json.length > MAX_ARG_JSON ? `${json.slice(0, MAX_ARG_JSON)}\n…` : json;
  } catch {
    argsJson = '(could not serialize)';
  }
  return { title, toolId: toolName, description, argsJson };
}
