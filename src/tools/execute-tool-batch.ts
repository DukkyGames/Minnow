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

  // onToolDone is what appends the `tool` history row, so an aborted call still
  // has to route through it — otherwise the assistant tool_call is left orphaned
  // and every later send 400s on the unpaired tool_call_id.
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

/**
 * Execute tool calls with parallel segments for read-only tools and sequential
 * segments for mutating / interactive tools. Outcomes are in original order.
 *
 * Invariant: every call in `toolCalls` produces exactly one `onToolDone`, even
 * when the batch is aborted. Callers append the `tool` history row from that
 * callback, so a skipped call would orphan its assistant `tool_call_id` and make
 * every subsequent request to the provider fail.
 */
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
      // Sequential segments hold one call today, but the break above would
      // otherwise silently drop the tail if that ever changes.
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

    // With more parallel-safe calls than pool workers, an abort leaves calls the
    // pool never picked up. Fill them here rather than after every segment so the
    // emitted rows stay in call order.
    if (segmentRun.aborted) {
      fillStopped(segment.calls);
    }
  }

  fillStopped(options.toolCalls);

  return options.toolCalls.map((tc) => outcomeById.get(tc.id)!);
}
