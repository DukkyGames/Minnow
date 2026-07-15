/**
 * Super Plan controller injects stage instructions as user history rows.
 * They must reach the model but should not appear in the chat transcript.
 */

import type { Chat, UserMessage } from '../../types';
import { isSuperPlanStageId, SUPER_PLAN_STAGE_LABELS, type SuperPlanStageId } from './types.ts';

const PIPELINE_USER_PREFIX = 'Super Plan pipeline —';

/** True when a user row is an internal Super Plan stage controller prompt. */
export function isSuperPlanPipelineUserMessage(msg: UserMessage): boolean {
  if (msg.superPlanStage && isSuperPlanStageId(msg.superPlanStage)) {
    return true;
  }
  return msg.content.trimStart().startsWith(PIPELINE_USER_PREFIX);
}

/** Stamp a pushed user row as a hidden Super Plan stage instruction. */
export function superPlanPipelineUserMessage(
  content: string,
  stageId: SuperPlanStageId,
): UserMessage {
  return { role: 'user', content, superPlanStage: stageId };
}

/**
 * After a failed Super Plan stage turn, history rollback removes assistant/tool rows.
 * Append a visible notice so "View chat" still shows why the stage stopped.
 */
export function appendSuperPlanStageFailureNotice(
  chat: Chat,
  stageId: SuperPlanStageId,
  errorMessage: string,
): void {
  const detail = errorMessage.trim();
  if (!detail) return;
  const label = SUPER_PLAN_STAGE_LABELS[stageId];
  chat.history.push({
    role: 'assistant',
    content: `**${label} failed**\n\n${detail}`,
  });
}
