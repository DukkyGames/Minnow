/**
 * Parent-facing spawn/cancel sub-agent tools (Step 09).
 */

import {
  cancelSubAgent,
  formatAggregateResult,
  spawnSubAgent,
} from '../agents/orchestrator';
import type { SubAgentExecutorContext } from '../agents/types';

let executorContext: SubAgentExecutorContext | null = null;

/** Set parent turn context for spawn/cancel (from tool loop). */
export function setSubAgentExecutorContext(
  ctx: SubAgentExecutorContext | null,
): void {
  executorContext = ctx;
}

/** Execute spawn_sub_agent or cancel_sub_agent. */
export async function executeSubAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === 'spawn_sub_agent') {
    const type = typeof args.type === 'string' ? args.type.trim() : '';
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    const wait = args.wait !== false;

    if (!type) return 'Error: spawn_sub_agent requires "type"';
    if (!task) return 'Error: spawn_sub_agent requires "task"';

    try {
      const result = await spawnSubAgent({
        type,
        task,
        wait,
        parentTurnId: executorContext?.parentTurnId ?? null,
        modeId: executorContext?.modeId,
      });

      if ('summary' in result && 'toolTurns' in result) {
        return formatAggregateResult(result);
      }

      return JSON.stringify(result, null, 2);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return message.startsWith('Error:') ? message : `Error: ${message}`;
    }
  }

  if (name === 'cancel_sub_agent') {
    const runId =
      typeof args.run_id === 'string'
        ? args.run_id.trim()
        : typeof args.runId === 'string'
          ? args.runId.trim()
          : '';
    const reason =
      typeof args.reason === 'string' && args.reason.trim()
        ? args.reason.trim()
        : 'cancelled';

    if (!runId) return 'Error: cancel_sub_agent requires "run_id"';

    const result = cancelSubAgent(runId, reason);
    return JSON.stringify(result, null, 2);
  }

  return `Error: unknown sub-agent tool "${name}"`;
}
