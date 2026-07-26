/**
 * Session Engine commands for sub-agent spawn/cancel (MIN-361 Phase 3).
 * Used when a renderer (or remote device) must mutate the engine-owned registry.
 */

import {
  cancelSubAgent,
  spawnSubAgent,
  waitForSubAgent,
} from '../agents/controller/controller.ts';
import type { SpawnSubAgentInput } from '../agents/types.ts';
import type { BoardCategory } from '../types.ts';

const BOARD_CATEGORIES = new Set<BoardCategory>(['build', 'fix', 'test', 'research']);

export type ControllerSessionCommand =
  | {
      type: 'spawn_sub_agent';
      agentType: string;
      task: string;
      wait?: boolean;
      parentChatId?: string | null;
      parentTurnId?: string | null;
      parentToolCallId?: string | null;
      modeId?: string;
      category?: string;
      boardTaskId?: string;
      providerId?: string;
      modelId?: string;
      timeoutMs?: number;
    }
  | {
      type: 'cancel_sub_agent';
      runId: string;
      reason?: string;
    };

/**
 * Run a controller command against the in-process registry.
 * Returns a small JSON-serializable detail for the 202 response.
 */
export async function applyControllerSessionCommand(
  cmd: ControllerSessionCommand | { type: string; [key: string]: unknown },
): Promise<{ accepted: boolean; detail?: string }> {
  if (cmd.type === 'cancel_sub_agent') {
    const runId = typeof cmd.runId === 'string' ? cmd.runId.trim() : '';
    if (!runId) {
      throw Object.assign(new Error('runId is required'), { statusCode: 400 });
    }
    const reason =
      typeof cmd.reason === 'string' && cmd.reason.trim()
        ? cmd.reason.trim()
        : 'cancelled';
    const result = cancelSubAgent(runId, reason);
    return {
      accepted: result.ok,
      detail: JSON.stringify(result),
    };
  }

  if (cmd.type === 'spawn_sub_agent') {
    const agentType =
      typeof (cmd as { agentType?: string }).agentType === 'string'
        ? (cmd as { agentType: string }).agentType.trim()
        : typeof (cmd as { agent_type?: string }).agent_type === 'string'
          ? (cmd as { agent_type: string }).agent_type.trim()
          : typeof (cmd as { subAgentType?: string }).subAgentType === 'string'
            ? (cmd as { subAgentType: string }).subAgentType.trim()
            : '';
    const task = typeof cmd.task === 'string' ? cmd.task.trim() : '';
    if (!agentType) {
      throw Object.assign(new Error('agentType is required'), { statusCode: 400 });
    }
    if (!task) {
      throw Object.assign(new Error('task is required'), { statusCode: 400 });
    }

    const categoryRaw =
      typeof (cmd as { category?: string }).category === 'string'
        ? (cmd as { category: string }).category.trim()
        : '';
    const category = BOARD_CATEGORIES.has(categoryRaw as BoardCategory)
      ? (categoryRaw as BoardCategory)
      : undefined;

    const wantWait = (cmd as { wait?: boolean }).wait === true;
    const input: SpawnSubAgentInput = {
      type: agentType,
      task,
      // Always non-blocking here — wait in-process after 202 payload is built when asked.
      wait: false,
      parentChatId: (cmd as { parentChatId?: string | null }).parentChatId ?? null,
      parentTurnId: (cmd as { parentTurnId?: string | null }).parentTurnId ?? null,
      parentToolCallId:
        (cmd as { parentToolCallId?: string | null }).parentToolCallId ?? null,
      modeId: (cmd as { modeId?: string }).modeId,
      ...(category ? { category } : {}),
      ...((cmd as { boardTaskId?: string }).boardTaskId
        ? { boardTaskId: (cmd as { boardTaskId: string }).boardTaskId }
        : {}),
      ...((cmd as { providerId?: string }).providerId
        ? { providerId: (cmd as { providerId: string }).providerId }
        : {}),
      ...((cmd as { modelId?: string }).modelId
        ? { modelId: (cmd as { modelId: string }).modelId }
        : {}),
      ...((cmd as { timeoutMs?: number }).timeoutMs !== undefined
        ? { timeoutMs: (cmd as { timeoutMs: number }).timeoutMs }
        : {}),
    };

    const result = await spawnSubAgent(input);
    if (!wantWait || !('runId' in result)) {
      return { accepted: true, detail: JSON.stringify(result) };
    }
    // Engine-local wait (command handler already owns the registry).
    const aggregate = await waitForSubAgent(result.runId);
    return { accepted: true, detail: JSON.stringify(aggregate) };
  }

  throw Object.assign(new Error(`Unknown controller command: ${cmd.type}`), {
    statusCode: 400,
  });
}
