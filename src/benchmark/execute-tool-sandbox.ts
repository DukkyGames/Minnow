/**
 * Benchmark-safe tool execution: stub UI-blocking tools so probes never open chat modals.
 */

import { executeTool, type ExecuteToolContext } from '../tools/client';
import type { ToolExecutionResult } from '../types';
import { stringifyAskQuestionResult } from '../tools/ask-question-types';
import { EMIT_ONLY_TOOL_IDS } from './suites/tools-fixtures.ts';

/** Tools that enqueue modals, spawn agents, or need live user input — never run during bench. */
const BENCHMARK_STUB_TOOL_IDS = new Set<string>([
  ...EMIT_ONLY_TOOL_IDS,
  'propose_mode_switch',
  'request_browser_origin_access',
]);

export interface BenchmarkExecuteToolOptions {
  workspaceRoot?: string;
  modeId?: string;
}

function stubBenchmarkTool(name: string): ToolExecutionResult {
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
 * Single autonomous execution path for benchmark suites — no approval or question modals.
 */
export function executeBenchmarkTool(
  name: string,
  args: Record<string, unknown>,
  opts: BenchmarkExecuteToolOptions = {},
): ReturnType<typeof executeTool> {
  if (BENCHMARK_STUB_TOOL_IDS.has(name)) {
    return Promise.resolve(stubBenchmarkTool(name));
  }

  const context: ExecuteToolContext = {
    benchmarkAutonomous: true,
    workspaceRoot: opts.workspaceRoot,
    modeId: opts.modeId,
  };
  return executeTool(name, args, context);
}

/**
 * `executeToolFn` for `runToolLoop` during benchmark suites — stubs emit-only / UI tools.
 */
export function createBenchmarkExecuteToolFn(
  opts: BenchmarkExecuteToolOptions = {},
): (
  name: string,
  args: Record<string, unknown>,
  context?: ExecuteToolContext,
) => ReturnType<typeof executeTool> {
  return (name, args, context) =>
    executeBenchmarkTool(name, args, {
      workspaceRoot: opts.workspaceRoot ?? context?.workspaceRoot,
      modeId: context?.modeId ?? opts.modeId,
    });
}

/** Whether a tool id is stubbed during benchmark runs (unit tests). */
export function isBenchmarkStubbedTool(name: string): boolean {
  return BENCHMARK_STUB_TOOL_IDS.has(name);
}
