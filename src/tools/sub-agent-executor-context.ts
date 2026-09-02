import type { SubAgentExecutorContext } from '../agents/types';

let executorContext: SubAgentExecutorContext | null = null;

/** Set parent turn context for spawn/cancel (from the tool loop). */
export function setSubAgentExecutorContext(
  ctx: SubAgentExecutorContext | null,
): void {
  executorContext = ctx;
}

export function getSubAgentExecutorContext(): SubAgentExecutorContext | null {
  return executorContext;
}
