/**
 * Typed board command dispatch for the Session Engine (MIN-360 Phase 2).
 * Runs against the engine-hosted sessionState alias + board-actions module.
 */

import {
  continueBoardTask,
  moveTaskToNewChat,
  recoverMergingBoardTask,
  requeueBoardTask,
  restartBoardTask,
  setBoardExecutionMode,
  startBoardAutoRun,
  startFinalIntegrationTestForPlannerChat,
  startTaskForPlannerChat,
  stopBoardAutoRun,
} from '../state/orchestrate-board-actions.ts';
import { initBoard, type InitBoardInput } from '../state/orchestrate-board-store.ts';
import { findGroupById, getOrCreateBoardGroup, getPlannerChatForGroup } from '../state/chat-groups.ts';
import { findChatById, sessionState } from '../state/sessions.ts';
import type { Chat, ChatGroup, SessionState } from '../types.ts';
import { activateEngineBoardHost } from './board-host.ts';

export type BoardCommand =
  | {
      type: 'board_init';
      plannerChatId: string;
      planPath: string;
      tasks: InitBoardInput['tasks'];
      waves: InitBoardInput['waves'];
    }
  | { type: 'board_start'; groupId: string }
  | { type: 'board_stop'; groupId: string; reason?: 'user' | 'system' }
  | { type: 'board_start_task'; groupId: string; taskId: string }
  | { type: 'board_requeue_task'; groupId: string; taskId: string }
  | {
      type: 'board_set_autonomy';
      groupId: string;
      level: 'manual' | 'sequential' | 'auto' | 'afk';
      start?: boolean;
    }
  | { type: 'board_run_final_test'; groupId: string }
  | {
      type: 'board_recover_task';
      groupId: string;
      taskId: string;
      action: 'restart' | 'continue' | 'move_to_new_chat' | 'reconcile_merge';
    }
  | {
      type: 'set_model';
      chatId?: string;
      groupId?: string;
      providerId?: string;
      modelId: string;
    };

function requireGroup(groupId: string): ChatGroup {
  const group = findGroupById(groupId);
  if (!group?.orchestrateBoard) {
    throw Object.assign(new Error(`Board group not found: ${groupId}`), {
      statusCode: 404,
    });
  }
  return group;
}

function requirePlanner(group: ChatGroup): Chat {
  const planner = getPlannerChatForGroup(group);
  if (!planner) {
    throw Object.assign(new Error(`Planner chat not found for group ${group.id}`), {
      statusCode: 404,
    });
  }
  return planner;
}

/**
 * Apply a board command. Long-running work (start_task turns) continues in the
 * background after this returns — same fire-and-forget pattern as send_message.
 *
 * Callers (commands.js) must publishLiveEngineState after this returns so the
 * validated engine blob replaces any stale sessionState alias.
 */
export async function applyBoardCommand(
  cmd: BoardCommand,
): Promise<{ accepted: boolean; detail?: string }> {
  await activateEngineBoardHost();
  // Re-bind in case a prior publishLive replaced engineState under us.
  const { getEngineSessionState } = await import('../../server/session/engine-api.js');
  const { setSessionStateForEngineHost } = await import('../state/sessions.ts');
  const live = getEngineSessionState();
  if (live) setSessionStateForEngineHost(live as SessionState);

  switch (cmd.type) {
    case 'board_init': {
      const planner = findChatById(cmd.plannerChatId);
      if (!planner) {
        throw Object.assign(new Error(`Chat not found: ${cmd.plannerChatId}`), {
          statusCode: 404,
        });
      }
      const group = getOrCreateBoardGroup(planner);
      initBoard(group, planner, {
        planPath: cmd.planPath,
        tasks: cmd.tasks,
        waves: cmd.waves,
      });
      return { accepted: true };
    }
    case 'board_start': {
      const group = requireGroup(cmd.groupId);
      const planner = requirePlanner(group);
      startBoardAutoRun(group, planner);
      return { accepted: true };
    }
    case 'board_stop': {
      const group = requireGroup(cmd.groupId);
      const planner = requirePlanner(group);
      stopBoardAutoRun(group, planner, { reason: cmd.reason ?? 'user' });
      return { accepted: true };
    }
    case 'board_start_task': {
      const group = requireGroup(cmd.groupId);
      const planner = requirePlanner(group);
      // Fire-and-forget — HTTP already returns 202.
      void startTaskForPlannerChat(planner, cmd.taskId).catch((err) => {
        console.error('[session-engine] board_start_task failed:', err);
      });
      return { accepted: true };
    }
    case 'board_requeue_task': {
      const group = requireGroup(cmd.groupId);
      const planner = requirePlanner(group);
      void requeueBoardTask(group, cmd.taskId, planner).catch((err) => {
        console.error('[session-engine] board_requeue_task failed:', err);
      });
      return { accepted: true };
    }
    case 'board_set_autonomy': {
      const group = requireGroup(cmd.groupId);
      const planner = requirePlanner(group);
      setBoardExecutionMode(group, cmd.level, planner);
      if (cmd.start === true && cmd.level !== 'manual') {
        startBoardAutoRun(group, planner);
      }
      return { accepted: true };
    }
    case 'board_run_final_test': {
      const group = requireGroup(cmd.groupId);
      const planner = requirePlanner(group);
      void startFinalIntegrationTestForPlannerChat(planner).catch((err) => {
        console.error('[session-engine] board_run_final_test failed:', err);
      });
      return { accepted: true };
    }
    case 'board_recover_task': {
      const group = requireGroup(cmd.groupId);
      const planner = requirePlanner(group);
      const run = async (): Promise<void> => {
        switch (cmd.action) {
          case 'restart':
            await restartBoardTask(group, cmd.taskId, planner);
            return;
          case 'continue':
            await continueBoardTask(group, cmd.taskId, planner);
            return;
          case 'move_to_new_chat':
            await moveTaskToNewChat(group, cmd.taskId, planner);
            return;
          case 'reconcile_merge':
            await recoverMergingBoardTask(group, cmd.taskId, planner);
            return;
          default:
            throw Object.assign(new Error(`Unknown recover action: ${String(cmd.action)}`), {
              statusCode: 400,
            });
        }
      };
      void run().catch((err) => {
        console.error('[session-engine] board_recover_task failed:', err);
      });
      return { accepted: true };
    }
    case 'set_model': {
      const modelId = typeof cmd.modelId === 'string' ? cmd.modelId.trim() : '';
      if (!modelId) {
        throw Object.assign(new Error('modelId is required'), { statusCode: 400 });
      }
      const providerId =
        typeof cmd.providerId === 'string' ? cmd.providerId.trim() : '';
      const state = sessionState;
      if (!state) {
        throw Object.assign(new Error('No session state'), { statusCode: 500 });
      }
      if (cmd.chatId) {
        const chat = findChatById(cmd.chatId);
        if (!chat) {
          throw Object.assign(new Error(`Chat not found: ${cmd.chatId}`), {
            statusCode: 404,
          });
        }
        chat.modelId = modelId;
        if (providerId) chat.providerId = providerId;
        chat.updatedAt = Date.now();
      }
      if (cmd.groupId) {
        const group = findGroupById(cmd.groupId);
        if (group?.orchestrateBoard) {
          group.orchestrateBoard.preferredModelId = modelId;
          if (providerId) group.orchestrateBoard.preferredProviderId = providerId;
          group.orchestrateBoard.lastUpdatedAt = Date.now();
        }
      } else if (cmd.chatId) {
        // Also stamp the board for the planner's folder when only chatId is sent.
        const chat = findChatById(cmd.chatId);
        const groupId = chat?.boardGroupId?.trim() || chat?.groupId?.trim();
        if (groupId) {
          const group = findGroupById(groupId);
          if (group?.orchestrateBoard) {
            group.orchestrateBoard.preferredModelId = modelId;
            if (providerId) group.orchestrateBoard.preferredProviderId = providerId;
            group.orchestrateBoard.lastUpdatedAt = Date.now();
          }
        }
      }
      const { scheduleSaveSessions } = await import('../state/sessions.ts');
      scheduleSaveSessions();
      return { accepted: true };
    }
    default:
      throw Object.assign(
        new Error(`Unknown board command: ${(cmd as { type?: string }).type}`),
        { statusCode: 400 },
      );
  }
}
