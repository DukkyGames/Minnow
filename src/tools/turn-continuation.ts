/**
 * Pure helpers for tool-loop turn outcomes: empty post-tool retry, final content,
 * orphan tool-tail detection, and optional dev turn logging.
 */

import type { AssistantToolCallMessage, Message } from '../types';

/** localStorage key: set to `1` to log per-round tool-loop decisions in the console. */
export const TURN_DEBUG_STORAGE_KEY = 'minnowDebugTurns';

/** Max extra model rounds after an empty completion when history ends with tool rows. */
export const MAX_EMPTY_POST_TOOL_RETRIES = 1;

/** Ephemeral API-only user line (not stored in session history). */
export const EMPTY_POST_TOOL_CONTINUE_INSTRUCTION =
  'You have tool results above. Reply to the user in plain language; do not call more tools unless necessary.';

/** Ephemeral API-only line after max_tokens truncation (not stored in session history). */
export const CONTINUE_AFTER_TRUNCATION_INSTRUCTION =
  'Your previous reply was cut off because of the output token limit. Continue exactly where you left off without repeating what you already wrote.';

/** Max extra model rounds when prose looks like multiple-choice but `ask_question` was not called. */
export const MAX_PROSE_QUESTION_RETRIES = 1;

/** Ephemeral API-only correction when the model asked for choices in prose. */
export const PROSE_QUESTION_RETRY_INSTRUCTION =
  'Your previous reply is already in the chat. You presented multiple-choice options in plain text. Do not repeat that list in prose. Call the ask_question tool now with a questions array (each item: id, prompt, options as {id, label} objects). Wait for the user to answer before continuing.';

/**
 * Injected when the sub-agent has tools enabled but the first model reply did not call any
 * tool (prose-only). Forces another tool round before structured JSON finalization.
 */
export const SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION =
  'You must use the available tools to complete the task. Do not answer with prose only — call the appropriate tool(s) now, then summarize after you have tool results.';

export type TurnContinuation = 'continueTools' | 'finalize' | 'retryEmpty';

/** True when dev turn logging is enabled (`localStorage.minnowDebugTurns === '1'`). */
export function isTurnDebugEnabled(): boolean {
  try {
    return localStorage.getItem(TURN_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Log a structured turn-debug object when {@link isTurnDebugEnabled}. */
export function logTurnDebug(payload: Record<string, unknown>): void {
  if (!isTurnDebugEnabled()) return;
  console.debug('[minnow:turn]', payload);
}

/** History ends with tool result(s) or assistant tool_calls without a final prose reply. */
export function hasPostToolTail(history: Message[]): boolean {
  if (history.length === 0) return false;
  const last = history[history.length - 1];
  if (last?.role === 'tool') return true;
  if (last?.role === 'assistant') {
    const withTools = last as AssistantToolCallMessage;
    return Boolean(withTools.tool_calls?.length);
  }
  return false;
}

/**
 * Decide the next step after one streamed completion round.
 * `retryEmpty` applies only when the model returned no prose after tool results.
 */
export function resolveTurnContinuation(input: {
  finishReason: string | undefined;
  toolCallsCount: number;
  fullTextLength: number;
  hasPostToolTail: boolean;
  emptyPostToolRetries: number;
  maxEmptyPostToolRetries?: number;
}): TurnContinuation {
  const maxRetries = input.maxEmptyPostToolRetries ?? MAX_EMPTY_POST_TOOL_RETRIES;
  if (input.finishReason === 'tool_calls' && input.toolCallsCount > 0) {
    return 'continueTools';
  }
  if (
    input.fullTextLength === 0 &&
    input.hasPostToolTail &&
    input.emptyPostToolRetries < maxRetries
  ) {
    return 'retryEmpty';
  }
  return 'finalize';
}

/**
 * User-visible assistant content after stream + optional non-streaming fallback.
 * Prefers trimmed prose, then joined thinking segments, then a placeholder.
 */
export function resolveFinalAssistantContent(
  fullText: string,
  thinkingSegments: string[],
): { content: string; usedThinkingAsContent: boolean } {
  const trimmed = fullText.trim();
  if (trimmed) {
    return { content: trimmed, usedThinkingAsContent: false };
  }
  const thinking = thinkingSegments.filter((s) => s.trim().length > 0);
  if (thinking.length > 0) {
    return { content: thinking.join('\n\n'), usedThinkingAsContent: true };
  }
  return {
    content: 'The model returned no text.',
    usedThinkingAsContent: false,
  };
}
