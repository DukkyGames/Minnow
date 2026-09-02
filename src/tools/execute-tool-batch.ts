import { runWithConcurrency } from '../lib/concurrency-pool.ts';
import type { ToolCall, ToolExecutionResult } from '../types.ts';
import {
  MAX_PARALLEL_READ_TOOLS,
  partitionToolCalls,
} from './parallel-tool-policy.ts';
import { parseToolArguments } from './parse-tool-arguments.ts';

export const STOPPED_TOOL_MSG = 'Stopped by user.';

export interface ToolCallOutcome {
  toolCall: ToolCall;
  parseError?: string;
  result?: ToolExecutionResult;
}

export interface ExecuteToolBatchOptions {
  toolCalls: ToolCall[];
  constrained?: boolean;
  signal?: AbortSignal;
  execute: (
    name: string,
    args: unknown,
    ctx: { toolCallId: string },
  ) => Promise<ToolExecutionResult>;
  onToolStart?: (tc: ToolCall, args: unknown) => void;
  onToolDone?: (outcome: ToolCallOutcome) => void;
  onParallelSegmentStart?: (calls: ToolCall[]) => void;
}

async function runSingleToolCall(
  tc: ToolCall,
  options: ExecuteToolBatchOptions,
): Promise<ToolCallOutcome> {
  const { args, parseError } = parseToolArguments(tc.function.arguments, {
    constrained: options.constrained,
  });

  if (options.signal?.aborted) {
    const stopped: ToolCallOutcome = {
      toolCall: tc,
      result: { content: STOPPED_TOOL_MSG },
    };
    options.onToolStart?.(tc, args);
    options.onToolDone?.(stopped);
    return stopped;
  }

  options.onToolStart?.(tc, args);

  if (parseError) {
    const outcome: ToolCallOutcome = { toolCall: tc, parseError };
    options.onToolDone?.(outcome);
    return outcome;
  }

  const result = await options.execute(tc.function.name, args, {
    toolCallId: tc.id,
  });
  const outcome: ToolCallOutcome = { toolCall: tc, result };
  options.onToolDone?.(outcome);
  return outcome;
}

export async function executeToolCallBatch(
  options: ExecuteToolBatchOptions,
): Promise<ToolCallOutcome[]> {
  const segments = partitionToolCalls(options.toolCalls);
  const outcomeById = new Map<string, ToolCallOutcome>();

  /** Emit a stopped outcome for any call that never ran, in call order. */
  function fillStopped(calls: ToolCall[]): void {
    for (const tc of calls) {
      if (outcomeById.has(tc.id)) {
        continue;
      }
      const stopped: ToolCallOutcome = {
        toolCall: tc,
        result: { content: STOPPED_TOOL_MSG },
      };
      options.onToolStart?.(tc, {});
      options.onToolDone?.(stopped);
      outcomeById.set(tc.id, stopped);
    }
  }

  for (const segment of segments) {
    if (options.signal?.aborted) {
      fillStopped(segment.calls);
      continue;
    }

    if (segment.kind === 'sequential') {
      for (const tc of segment.calls) {
        const outcome = await runSingleToolCall(tc, options);
        outcomeById.set(tc.id, outcome);
        if (options.signal?.aborted) {
          break;
        }
      }
      fillStopped(segment.calls);
      continue;
    }

    options.onParallelSegmentStart?.(segment.calls);

    const poolItems = segment.calls.map((tc) => ({
      id: tc.id,
      payload: tc,
    }));

    const segmentRun = await runWithConcurrency<ToolCall, ToolCallOutcome>({
      items: poolItems,
      concurrency: Math.min(MAX_PARALLEL_READ_TOOLS, segment.calls.length),
      signal: options.signal,
      worker: async ({ item }) => runSingleToolCall(item.payload, options),
    });

    for (const outcome of segmentRun.results) {
      outcomeById.set(outcome.toolCall.id, outcome);
    }

    if (segmentRun.aborted) {
      fillStopped(segment.calls);
    }
  }

  fillStopped(options.toolCalls);

  return options.toolCalls.map((tc) => outcomeById.get(tc.id)!);
}
