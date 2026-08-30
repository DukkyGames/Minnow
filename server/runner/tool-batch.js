/**
 * Bounded parallel + sequential execution for one assistant tool_calls batch.
 *
 * Port of `src/tools/execute-tool-batch.ts` + `parse-tool-arguments.ts` +
 * `src/lib/concurrency-pool.ts`. Same abort / onToolDone invariants as the
 * renderer path so a skipped call cannot orphan a `tool_call_id`.
 */

import {
  MAX_PARALLEL_READ_TOOLS,
  partitionToolCalls,
} from './parallel-tool-policy.js';

export const STOPPED_TOOL_MSG = 'Stopped by user.';

export const TOOL_ARGUMENTS_INVALID_JSON = 'Tool arguments were not valid JSON.';

export const TOOL_ARGUMENTS_EMPTY =
  'Tool arguments were empty. Retry the tool call with a complete JSON object for all required fields.';

/**
 * Parse a tool arguments string into a plain object.
 * Legacy mode returns `{}` on failure; constrained mode surfaces an error message.
 * @param {string} raw
 * @param {{ constrained?: boolean }} [options]
 * @returns {{ args: Record<string, unknown>, parseError?: string }}
 */
export function parseToolArguments(raw, options = {}) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    if (options.constrained) {
      return { args: {}, parseError: TOOL_ARGUMENTS_EMPTY };
    }
    return { args: {} };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed };
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

/**
 * Run work items with a bounded worker pool. Results preserve input order but
 * only cover items that actually ran (an abort leaves gaps, filled by the batch).
 * @template T
 * @template R
 * @param {{
 *   items: Array<{ id: string, payload: T }>,
 *   concurrency: number,
 *   signal?: AbortSignal,
 *   worker: (ctx: { item: { id: string, payload: T }, signal: AbortSignal }) => Promise<R>,
 * }} options
 * @returns {Promise<{ results: R[], aborted: boolean }>}
 */
export async function runWithConcurrency(options) {
  const signal = options.signal ?? new AbortController().signal;
  const concurrency = Math.max(1, options.concurrency);
  /** @type {Map<number, unknown>} */
  const byIndex = new Map();
  let index = 0;

  async function workerLoop() {
    while (index < options.items.length) {
      if (signal.aborted) {
        return;
      }
      const i = index;
      index += 1;
      const item = options.items[i];
      const result = await options.worker({ item, signal });
      byIndex.set(i, result);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));

  /** @type {unknown[]} */
  const results = [];
  for (let i = 0; i < options.items.length; i += 1) {
    if (byIndex.has(i)) {
      results.push(byIndex.get(i));
    }
  }
  return { results, aborted: results.length < options.items.length };
}

/**
 * @param {object} tc
 * @param {object} options
 */
async function runSingleToolCall(tc, options) {
  const argStr = typeof tc?.function?.arguments === 'string' ? tc.function.arguments : '';
  const { args, parseError } = parseToolArguments(argStr, {
    constrained: options.constrained,
  });

  // onToolDone appends the `tool` history row. An aborted call still has to
  // route through it — otherwise the assistant tool_call is left orphaned.
  if (options.signal?.aborted) {
    const stopped = {
      toolCall: tc,
      result: { content: STOPPED_TOOL_MSG },
    };
    options.onToolStart?.(tc, args);
    options.onToolDone?.(stopped);
    return stopped;
  }

  options.onToolStart?.(tc, args);

  if (parseError) {
    const outcome = { toolCall: tc, parseError };
    options.onToolDone?.(outcome);
    return outcome;
  }

  const result = await options.execute(tc.function.name, args, {
    toolCallId: tc.id,
  });
  const outcome = { toolCall: tc, result };
  options.onToolDone?.(outcome);
  return outcome;
}

/**
 * Execute tool calls with parallel segments for read-only tools and sequential
 * segments for mutating / interactive tools. Outcomes are in original order.
 *
 * Invariant: every call in `toolCalls` produces exactly one `onToolDone`, even
 * when the batch is aborted.
 *
 * @param {{
 *   toolCalls: object[],
 *   constrained?: boolean,
 *   signal?: AbortSignal,
 *   execute: (name: string, args: unknown, ctx: { toolCallId: string }) => Promise<{ content: string }>,
 *   onToolStart?: (tc: object, args: unknown) => void,
 *   onToolDone?: (outcome: object) => void,
 *   onParallelSegmentStart?: (calls: object[]) => void,
 * }} options
 * @returns {Promise<object[]>}
 */
export async function executeToolCallBatch(options) {
  const toolCalls = Array.isArray(options.toolCalls) ? options.toolCalls : [];
  const segments = partitionToolCalls(toolCalls);
  /** @type {Map<string, object>} */
  const outcomeById = new Map();

  /** Emit a stopped outcome for any call that never ran, in call order. */
  function fillStopped(calls) {
    for (const tc of calls) {
      if (outcomeById.has(tc.id)) {
        continue;
      }
      const stopped = {
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

    const segmentRun = await runWithConcurrency({
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

  fillStopped(toolCalls);

  return toolCalls.map((tc) => outcomeById.get(tc.id));
}
