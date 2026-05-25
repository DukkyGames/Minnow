/**
 * Parse tool call `function.arguments` JSON for main chat and sub-agents.
 */

export const TOOL_ARGUMENTS_INVALID_JSON =
  'Tool arguments were not valid JSON.';

export interface ParseToolArgumentsOptions {
  /** When true, invalid JSON yields a user-visible error instead of silent `{}`. */
  constrained?: boolean;
}

export interface ParseToolArgumentsResult {
  args: Record<string, unknown>;
  parseError?: string;
}

/**
 * Parse a tool arguments string into a plain object.
 * Legacy mode returns `{}` on failure; constrained mode surfaces an error message.
 */
export function parseToolArguments(
  raw: string,
  options: ParseToolArgumentsOptions = {},
): ParseToolArgumentsResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { args: {} };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown> };
    }
    if (options.constrained) {
      return { args: {}, parseError: TOOL_ARGUMENTS_INVALID_JSON };
    }
    return { args: {} };
  } catch {
    if (options.constrained) {
      return { args: {}, parseError: TOOL_ARGUMENTS_INVALID_JSON };
    }
    return { args: {} };
  }
}
