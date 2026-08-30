/** Max concurrent read-only tool executions per parallel segment. */
export const MAX_PARALLEL_READ_TOOLS: 6;

/** True when a tool may run concurrently with other parallel-safe tools in the same turn. */
export function isParallelSafeTool(name: string): boolean;

export type ToolCallSegment<T = unknown> =
  | { kind: 'parallel'; calls: T[] }
  | { kind: 'sequential'; calls: T[] };

/**
 * Split tool_calls into ordered segments: consecutive parallel-safe calls share one
 * parallel segment; each non-safe call is its own sequential segment.
 */
export function partitionToolCalls<T extends { function?: { name?: string } }>(
  toolCalls: T[],
): ToolCallSegment<T>[];
