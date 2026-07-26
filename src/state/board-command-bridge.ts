/**
 * Route orchestrate board UI actions through Session Engine commands when
 * Session Engine is on by default (MIN-362); emergency opt-out calls local board-actions.
 */

import { isServerEngineEnabled } from './server-engine-flag.ts';
import {
  dispatchBoardRecoverTask,
  dispatchBoardRequeueTask,
  dispatchBoardRunFinalTest,
  dispatchBoardSetAutonomy,
  dispatchBoardStart,
  dispatchBoardStartTask,
  dispatchBoardStop,
  dispatchSetModel,
} from './session-commands.ts';
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
} from './orchestrate-board-actions.ts';
import type { Chat, ChatGroup } from '../types.ts';

/** Start auto/sequential/AFK board run. */
export async function boardUiStart(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  if (isServerEngineEnabled()) {
    await dispatchBoardStart(group.id);
    return;
  }
  startBoardAutoRun(group, plannerChat);
}

/** Stop board auto-run. */
export async function boardUiStop(
  group: ChatGroup,
  plannerChat: Chat,
  reason: 'user' | 'system' = 'user',
): Promise<void> {
  if (isServerEngineEnabled()) {
    await dispatchBoardStop(group.id, reason);
    return;
  }
  stopBoardAutoRun(group, plannerChat, { reason });
}

/** Set execution mode (+ optional start). */
export async function boardUiSetAutonomy(
  group: ChatGroup,
  plannerChat: Chat,
  level: 'manual' | 'sequential' | 'auto' | 'afk',
  start?: boolean,
): Promise<void> {
  if (isServerEngineEnabled()) {
    await dispatchBoardSetAutonomy(group.id, level, start);
    return;
  }
  setBoardExecutionMode(group, level, plannerChat);
  if (start === true && level !== 'manual') {
    startBoardAutoRun(group, plannerChat);
  }
}

/** Start one planned task. */
export async function boardUiStartTask(
  group: ChatGroup,
  plannerChat: Chat,
  taskId: string,
): Promise<void> {
  if (isServerEngineEnabled()) {
    await dispatchBoardStartTask(group.id, taskId);
    return;
  }
  await startTaskForPlannerChat(plannerChat, taskId);
}

/** Requeue a quarantined / failed task. */
export async function boardUiRequeueTask(
  group: ChatGroup,
  plannerChat: Chat,
  taskId: string,
): Promise<void> {
  if (isServerEngineEnabled()) {
    await dispatchBoardRequeueTask(group.id, taskId);
    return;
  }
  await requeueBoardTask(group, taskId, plannerChat);
}

/** Run final integration test. */
export async function boardUiRunFinalTest(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  if (isServerEngineEnabled()) {
    await dispatchBoardRunFinalTest(group.id);
    return;
  }
  await startFinalIntegrationTestForPlannerChat(plannerChat);
}

/** Recovery actions (MIN-222). */
export async function boardUiRecoverTask(
  group: ChatGroup,
  plannerChat: Chat,
  taskId: string,
  action: 'restart' | 'continue' | 'move_to_new_chat' | 'reconcile_merge',
): Promise<void> {
  if (isServerEngineEnabled()) {
    await dispatchBoardRecoverTask(group.id, taskId, action);
    return;
  }
  switch (action) {
    case 'restart':
      await restartBoardTask(group, taskId, plannerChat);
      return;
    case 'continue':
      await continueBoardTask(group, taskId, plannerChat);
      return;
    case 'move_to_new_chat':
      await moveTaskToNewChat(group, taskId, plannerChat);
      return;
    case 'reconcile_merge':
      await recoverMergingBoardTask(group, taskId, plannerChat);
      return;
  }
}

/** Persist top-bar model onto planner/board preferred binding. */
export async function boardUiSetModel(payload: {
  chatId?: string;
  groupId?: string;
  providerId?: string;
  modelId: string;
}): Promise<void> {
  if (!isServerEngineEnabled()) return;
  await dispatchSetModel(payload);
}
