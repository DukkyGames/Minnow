import { apiMessageContentToText } from '../../api/message-content';
import type { Chat, UserMessage } from '../../types';
import { isSuperPlanStageId, SUPER_PLAN_STAGE_LABELS, type SuperPlanStageId } from './types.ts';

const PIPELINE_USER_PREFIX = 'Super Plan pipeline —';

/** True when a user row is an internal Super Plan stage controller prompt. */
export function isSuperPlanPipelineUserMessage(msg: UserMessage): boolean {
  if (msg.superPlanStage && isSuperPlanStageId(msg.superPlanStage)) {
    return true;
  }
  // Coerce leaked ContentPart[] so reload cannot throw `content.trimStart is not a function`.
  return apiMessageContentToText(msg.content).trimStart().startsWith(PIPELINE_USER_PREFIX);
}

/** Stamp a pushed user row as a hidden Super Plan stage instruction. */
export function superPlanPipelineUserMessage(
  content: string,
  stageId: SuperPlanStageId,
): UserMessage {
  return { role: 'user', content, superPlanStage: stageId };
}

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
