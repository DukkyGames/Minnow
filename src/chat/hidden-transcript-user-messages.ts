/**
 * User history rows that must reach the model but should not appear in the chat transcript.
 */

import type { UserMessage } from '../types';
import { isSuperPlanPipelineUserMessage } from './super-plan/hidden-user-messages';

const SUB_AGENT_RESUME_PREFIXES = [
  '[Sub-agent finished]',
  '[Sub-agent check-in]',
  '[Sub-agent] No terminal',
] as const;

/** True when a user row is an automatic sub-agent completion or check-in resume prompt. */
export function isSubAgentResumeUserMessage(msg: UserMessage): boolean {
  const trimmed = msg.content.trimStart();
  return SUB_AGENT_RESUME_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** True when a user row should be omitted from transcript rendering. */
export function isHiddenTranscriptUserMessage(msg: UserMessage): boolean {
  if (msg.hiddenFromTranscript) return true;
  if (isSuperPlanPipelineUserMessage(msg)) return true;
  if (isSubAgentResumeUserMessage(msg)) return true;
  return false;
}

/** Stamp a pushed user row as hidden from the chat transcript UI. */
export function hiddenTranscriptUserMessage(content: string): UserMessage {
  return { role: 'user', content, hiddenFromTranscript: true };
}
