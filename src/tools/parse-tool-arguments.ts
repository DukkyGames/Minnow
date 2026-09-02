export const TOOL_ARGUMENTS_INVALID_JSON =
  'Tool arguments were not valid JSON.';

export const TOOL_ARGUMENTS_EMPTY =
  'Tool arguments were empty. Retry the tool call with a complete JSON object for all required fields.';

export interface ParseToolArgumentsOptions {
  /** When true, invalid JSON yields a user-visible error instead of silent `{}`. */
  constrained?: boolean;
}

export interface ParseToolArgumentsResult {
  args: Record<string, unknown>;
  parseError?: string;
}

export function parseToolArguments(
  raw: string,
  options: ParseToolArgumentsOptions = {},
): ParseToolArgumentsResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (options.constrained) {
      return { args: {}, parseError: TOOL_ARGUMENTS_EMPTY };
    }
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
