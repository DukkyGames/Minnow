/**
 * Per-tool benchmark prompts and arg expectations.
 */

import type { ToolDefinition } from '../../tools/definitions';

export interface ToolFixture {
  prompt: string;
  /** Pass if tool name matches and args satisfy predicate. */
  expectArgs?: (args: Record<string, unknown>) => boolean;
  /** Valid tool_call only; do not execute. */
  emitOnly?: boolean;
}

/** Tools that must not be executed during benchmark (UI / policy). */
export const EMIT_ONLY_TOOL_IDS = new Set([
  'ask_question',
  'spawn_sub_agent',
  'spawn_work_agent',
  'board_init',
  'board_update_task',
  'board_get_state',
]);

const OVERRIDES: Record<string, ToolFixture> = {
  get_datetime: {
    prompt: 'Call get_datetime now. Use the tool; do not answer from memory.',
  },
  calculate: {
    prompt: 'Use calculate to compute (12 + 8) * 2. Call the tool.',
    expectArgs: (a) => typeof a.expression === 'string' && a.expression.length > 0,
  },
  read_file: {
    prompt: 'Use read_file on package.json in the workspace root. Call the tool.',
    expectArgs: (a) => typeof a.path === 'string',
  },
  list_directory: {
    prompt: 'Use list_directory on "." Call the tool.',
    expectArgs: (a) => typeof a.path === 'string',
  },
  grep: {
    prompt: 'Use grep to search for "export" in src with pattern export. Call the tool.',
    expectArgs: (a) => typeof a.pattern === 'string',
  },
  web_search: {
    prompt: 'Use web_search for "TypeScript". Call the tool only.',
    expectArgs: (a) => typeof a.query === 'string',
    emitOnly: true,
  },
  ask_question: {
    prompt:
      'Call ask_question with one question id "bench-scope", prompt "Pick a scope", and two options bench-a and bench-b. Use the tool only.',
    expectArgs: (a) => Array.isArray(a.questions) && (a.questions as unknown[]).length > 0,
  },
};

export function getToolFixture(tool: ToolDefinition): ToolFixture {
  const override = OVERRIDES[tool.id];
  if (override) return { emitOnly: EMIT_ONLY_TOOL_IDS.has(tool.id), ...override };

  return {
    prompt: `Call the ${tool.id} tool once with minimal valid arguments for its schema. Output only the tool call.`,
    emitOnly: EMIT_ONLY_TOOL_IDS.has(tool.id),
  };
}
