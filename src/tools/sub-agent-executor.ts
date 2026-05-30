/**
 * Parent-facing spawn/cancel sub-agent tools (Step 09).
 */

import {
  assertSubAgentRunReadableByParent,
  buildSubAgentStatusPayload,
  cancelSubAgent,
  formatAggregateResult,
  formatSubAgentListToolResultForChat,
  spawnSubAgent,
} from '../agents/orchestrator';
import { resolveSubAgentRunForParentSession } from '../agents/sub-agent-completion-push';
import { findChatById } from '../state/sessions';
import type { BoardCategory } from '../types';
import type { SubAgentExecutorContext } from '../agents/types';

const BOARD_CATEGORIES = new Set<BoardCategory>(['build', 'fix', 'test', 'research']);

let executorContext: SubAgentExecutorContext | null = null;

/** Set parent turn context for spawn/cancel (from tool loop). */
export function setSubAgentExecutorContext(
  ctx: SubAgentExecutorContext | null,
): void {
  executorContext = ctx;
}

/** Execute spawn/cancel/list/status sub-agent parent tools. */
export async function executeSubAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === 'spawn_sub_agent') {
    const type = typeof args.type === 'string' ? args.type.trim() : '';
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    const wait = args.wait === true;

    if (!type) return 'Error: spawn_sub_agent requires "type"';
    if (!task) return 'Error: spawn_sub_agent requires "task"';

    const categoryRaw = typeof args.category === 'string' ? args.category.trim() : '';
    const category = BOARD_CATEGORIES.has(categoryRaw as BoardCategory)
      ? (categoryRaw as BoardCategory)
      : undefined;
    const boardTaskId =
      typeof args.board_task_id === 'string'
        ? args.board_task_id.trim()
        : typeof args.boardTaskId === 'string'
          ? args.boardTaskId.trim()
          : undefined;

    try {
      const result = await spawnSubAgent({
        type,
        task,
        wait,
        parentTurnId: executorContext?.parentTurnId ?? null,
        parentChatId: executorContext?.parentChatId ?? null,
        parentToolCallId: executorContext?.parentToolCallId ?? null,
        modeId: executorContext?.modeId,
        ...(category ? { category } : {}),
        ...(boardTaskId ? { boardTaskId } : {}),
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

  if (name === 'list_sub_agents') {
    const parentChatId = executorContext?.parentChatId?.trim();
    if (!parentChatId) {
      return 'Error: list_sub_agents requires an active parent chat';
    }
    const chat = findChatById(parentChatId);
    return formatSubAgentListToolResultForChat(parentChatId, chat?.subAgentRuns);
  }

  if (name === 'get_sub_agent_status') {
    const parentChatId = executorContext?.parentChatId?.trim();
    if (!parentChatId) {
      return 'Error: get_sub_agent_status requires an active parent chat';
    }
    const runId =
      typeof args.run_id === 'string'
        ? args.run_id.trim()
        : typeof args.runId === 'string'
          ? args.runId.trim()
          : '';
    if (!runId) return 'Error: get_sub_agent_status requires "run_id"';

    try {
      const run = assertSubAgentRunReadableByParent(
        resolveSubAgentRunForParentSession(runId, parentChatId),
        { parentChatId, parentTurnId: executorContext?.parentTurnId },
      );
      return JSON.stringify(buildSubAgentStatusPayload(run), null, 2);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return message.startsWith('Error:') ? message : `Error: ${message}`;
    }
  }

  return `Error: unknown sub-agent tool "${name}"`;
}
