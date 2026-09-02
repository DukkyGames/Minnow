import { extractAssistantCompletionText } from '../../api/chat';
import { extractInlineThinkingFromContent } from '../../api/inline-thinking';
import { extractReasoningMessage } from '../../api/reasoning';

type GoalEvalCompletionMessage = {
  content?: string | unknown;
  parsed?: unknown;
  refusal?: string;
  reasoning?: string;
  reasoning_content?: string;
  thinking?: string;
} | null | undefined;

function preferVerdictText(primary: string, fallback: string): string {
  const primaryTrimmed = primary.trim();
  if (primaryTrimmed) return primaryTrimmed;
  return fallback.trim();
}

/** Unwrap thinking-only inline blocks when the model never emitted a separate reply. */
function unwrapThinkingOnlyBlock(text: string): string {
  const match =
    /^[\s]*<(?:redacted_)?think(?:ing)?(?:\s+[^>]*)?>([\s\S]*?)<\/(?:redacted_)?think(?:ing)?>\s*$/i.exec(
      text.trim(),
    );
  return match?.[1]?.trim() ?? '';
}

function normalizeEvaluatorText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const thinkingOnly = unwrapThinkingOnlyBlock(trimmed);
  if (thinkingOnly) return thinkingOnly;

  const { thinking, reply } = extractInlineThinkingFromContent(trimmed);
  const replyTrimmed = reply.trim();
  if (replyTrimmed) return replyTrimmed;
  if (thinking.length > 0) {
    return preferVerdictText(thinking.join('\n\n'), trimmed);
  }

  return trimmed;
}

/** Visible prose first; fall back to reasoning/thinking when content is empty. */
export function extractGoalEvalCompletionText(message: GoalEvalCompletionMessage): string {
  const fromAssistant = extractAssistantCompletionText(message).trim();
  if (fromAssistant) {
    return normalizeEvaluatorText(fromAssistant);
  }

  const fromReasoning = extractReasoningMessage(message).trim();
  if (fromReasoning) {
    return normalizeEvaluatorText(fromReasoning);
  }

  return '';
}
