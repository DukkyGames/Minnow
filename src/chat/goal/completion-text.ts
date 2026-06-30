/**
 * Extract evaluator completion text from non-streaming goal-eval responses.
 * Thinking models often leave `content` empty and write the verdict to reasoning channels.
 */

import { extractAssistantCompletionText } from '../../api/chat';
import { extractReasoningMessage } from '../../api/reasoning';

type GoalEvalCompletionMessage = {
  content?: string | unknown;
  parsed?: unknown;
  refusal?: string;
  reasoning?: string;
  reasoning_content?: string;
  thinking?: string;
} | null | undefined;

/** Visible prose first; fall back to reasoning/thinking when content is empty. */
export function extractGoalEvalCompletionText(message: GoalEvalCompletionMessage): string {
  const fromAssistant = extractAssistantCompletionText(message).trim();
  if (fromAssistant) return fromAssistant;

  return extractReasoningMessage(message).trim();
}
