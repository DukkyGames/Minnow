/**
 * Headless tool batch helper for sub-agents, evals, benchmarks, and CLI.
 */

import type { ToolCall, ToolExecutionResult } from '../types.ts';
import {
  executeToolCallBatch,
  type ToolCallOutcome,
} from './execute-tool-batch.ts';

export interface RunHeadlessToolBatchOptions {
  toolCalls: ToolCall[];
  constrained?: boolean;
  signal?: AbortSignal;
  execute: (
    name: string,
    args: unknown,
    ctx: { toolCallId: string },
  ) => Promise<ToolExecutionResult>;
  onToolDone?: (outcome: ToolCallOutcome) => void;
}

/** Execute a tool_calls batch without chat DOM side effects. */
export async function runHeadlessToolBatch(
  options: RunHeadlessToolBatchOptions,
): Promise<ToolCallOutcome[]> {
  return executeToolCallBatch({
    toolCalls: options.toolCalls,
    constrained: options.constrained,
    signal: options.signal,
    execute: options.execute,
    onToolDone: options.onToolDone,
  });
}
