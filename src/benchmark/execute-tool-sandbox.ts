/**
 * Benchmark-safe tool execution: stub UI-blocking tools so probes never open chat modals.
 */

import { executeTool, type ExecuteToolContext } from '../tools/client';
import { stringifyAskQuestionResult } from '../tools/ask-question-types';
import { EMIT_ONLY_TOOL_IDS } from './suites/tools-fixtures.ts';

/** Tools that enqueue modals, spawn agents, or need live user input — never run during bench. */
const BENCHMARK_STUB_TOOL_IDS = new Set<string>([
  ...EMIT_ONLY_TOOL_IDS,
  'propose_mode_switch',
]);

function stubBenchmarkTool(name: string): { content: string } {
  if (name === 'ask_question') {
    return {
      content: stringifyAskQuestionResult({
        status: 'cancelled',
        answers: [],
      }),
    };
  }

  return {
    content: JSON.stringify({
      ok: true,
      benchmark: true,
      stubbed: name,
    }),
  };
}

/**
 * `executeToolFn` for `runToolLoop` during benchmark suites — stubs emit-only / UI tools.
 */
export function createBenchmarkExecuteToolFn(
  modeId?: string,
): (
  name: string,
  args: Record<string, unknown>,
  context?: ExecuteToolContext,
) => ReturnType<typeof executeTool> {
  return (name, args, context) => {
    if (BENCHMARK_STUB_TOOL_IDS.has(name)) {
      return Promise.resolve(stubBenchmarkTool(name));
    }
    return executeTool(name, args, { ...context, modeId: context?.modeId ?? modeId });
  };
}

/** Whether a tool id is stubbed during benchmark runs (unit tests). */
export function isBenchmarkStubbedTool(name: string): boolean {
  return BENCHMARK_STUB_TOOL_IDS.has(name);
}
