/**
 * Human-readable summaries of tool invocations for the approval modal.
 */

import { getFieldByKey } from '../settings/field-registry';
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

function formatApprovalValue(value: unknown): string {
  if (value === undefined || value === null) return '(unset)';
  if (typeof value === 'string') return value || '(empty)';
  return JSON.stringify(value);
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

  if (toolName === 'update_settings' && Array.isArray(args.changes)) {
    const lines: string[] = [];
    for (const item of args.changes) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { key?: string; value?: unknown };
      const key = String(row.key ?? '').trim();
      if (!key) continue;
      const field = getFieldByKey(key);
      const label = field?.label ?? key;
      const newVal =
        field?.sensitivity === 'secret'
          ? '(set new secret value)'
          : formatApprovalValue(row.value);
      lines.push(`${label} → ${newVal}`);
    }
    argsJson = lines.length ? lines.join('\n') : '(no changes)';
  } else {
    try {
      const json = JSON.stringify(args, null, 2);
      argsJson =
        json.length > MAX_ARG_JSON ? `${json.slice(0, MAX_ARG_JSON)}\n…` : json;
    } catch {
      argsJson = '(could not serialize)';
    }
  }

  return { title, toolId: toolName, description, argsJson };
}
