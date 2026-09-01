/**
 * Module-level parent latch for spawn/cancel/list/status.
 *
 * Lives in its own file so `orchestrator.ts` can read it without a cycle
 * through `sub-agent-executor.ts` (which imports spawn). P10-H sets this
 * around chat `execute` and clears it in `runChatTurn` `finally`. Do not
 * clear per-tool — parallel siblings share the latch.
 */

import type { SubAgentExecutorContext } from '../agents/types';

let executorContext: SubAgentExecutorContext | null = null;

/** Set parent turn context for spawn/cancel (from the tool loop). */
export function setSubAgentExecutorContext(
  ctx: SubAgentExecutorContext | null,
): void {
  executorContext = ctx;
}

/**
 * Current parent context, or null when no chat execute is in flight.
 * Tests prove P10-H/K clear the latch on every turn exit — a leak pins the
 * next turn's spawn cards to a stale tool row.
 */
export function getSubAgentExecutorContext(): SubAgentExecutorContext | null {
  return executorContext;
}
