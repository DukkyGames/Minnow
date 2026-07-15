/**
 * Super Plan controller injects stage instructions as user history rows.
 * They must reach the model but should not appear in the chat transcript.
 */

import type { UserMessage } from '../../types';
import { isSuperPlanStageId, type SuperPlanStageId } from './types.ts';

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
