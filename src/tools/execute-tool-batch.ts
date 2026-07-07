/**
 * Bounded parallel + sequential execution for one assistant tool_calls batch.
 */

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
    return {
      toolCall: tc,
      result: { content: STOPPED_TOOL_MSG },
    };
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

/**
 * Execute tool calls with parallel segments for read-only tools and sequential
 * segments for mutating / interactive tools. Outcomes are in original order.
 */
export async function executeToolCallBatch(
  options: ExecuteToolBatchOptions,
): Promise<ToolCallOutcome[]> {
  const segments = partitionToolCalls(options.toolCalls);
  const outcomeById = new Map<string, ToolCallOutcome>();

  for (const segment of segments) {
    if (options.signal?.aborted) {
      for (const tc of segment.calls) {
        if (!outcomeById.has(tc.id)) {
          const stopped: ToolCallOutcome = {
            toolCall: tc,
            result: { content: STOPPED_TOOL_MSG },
          };
          options.onToolStart?.(tc, {});
          options.onToolDone?.(stopped);
          outcomeById.set(tc.id, stopped);
        }
      }
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
      continue;
    }

    options.onParallelSegmentStart?.(segment.calls);

    const poolItems = segment.calls.map((tc) => ({
      id: tc.id,
      payload: tc,
    }));

    const segmentOutcomes = await runWithConcurrency<ToolCall, ToolCallOutcome>({
      items: poolItems,
      concurrency: Math.min(MAX_PARALLEL_READ_TOOLS, segment.calls.length),
      signal: options.signal,
      worker: async ({ item }) => runSingleToolCall(item.payload, options),
    });

    for (const outcome of segmentOutcomes) {
      outcomeById.set(outcome.toolCall.id, outcome);
    }
  }

  return options.toolCalls.map((tc) => {
    const outcome = outcomeById.get(tc.id);
    if (outcome) {
      return outcome;
    }
    return {
      toolCall: tc,
      result: { content: STOPPED_TOOL_MSG },
    };
  });
}
