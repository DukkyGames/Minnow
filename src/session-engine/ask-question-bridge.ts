/**
 * Engine ask_question pause/resume seam (MIN-354 residual).
 *
 * When the main-chat loop hits `ask_question`, it parks the tool call, soft-publishes
 * `chat.pendingAskQuestion` for the renderer strip, and awaits `answer_question`.
 */

import type { AskQuestionArgs, AskQuestionToolResult } from '../tools/ask-question-types.ts';
import { stringifyAskQuestionResult } from '../tools/ask-question-types.ts';

interface ParkedAskQuestion {
  toolCallId: string;
  args: AskQuestionArgs;
  resolve: (content: string) => void;
  reject: (err: Error) => void;
}

/** In-process waiters keyed by chatId (one parked question per chat). */
const parkedByChatId = new Map<string, ParkedAskQuestion>();

/** True when this chat is blocked on a user answer. */
export function hasParkedAskQuestion(chatId: string): boolean {
  return parkedByChatId.has(chatId);
}

/**
 * Park until {@link resolveParkedAskQuestion} / cancel. Rejects if a prior park
 * is still open for the same chat (should not happen in a serial tool batch).
 */
export function parkAskQuestion(
  chatId: string,
  toolCallId: string,
  args: AskQuestionArgs,
  signal?: AbortSignal,
): Promise<string> {
  const existing = parkedByChatId.get(chatId);
  if (existing) {
    existing.reject(new Error('ask_question superseded by a newer park'));
    parkedByChatId.delete(chatId);
  }

  return new Promise<string>((resolve, reject) => {
    const onAbort = (): void => {
      const parked = parkedByChatId.get(chatId);
      if (!parked || parked.toolCallId !== toolCallId) return;
      parkedByChatId.delete(chatId);
      parked.resolve(
        stringifyAskQuestionResult({ status: 'cancelled', answers: [] }),
      );
    };

    if (signal?.aborted) {
      resolve(stringifyAskQuestionResult({ status: 'cancelled', answers: [] }));
      return;
    }

    parkedByChatId.set(chatId, {
      toolCallId,
      args,
      resolve: (content) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(content);
      },
      reject: (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    });

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Resume a parked ask_question with a structured tool result.
 * @returns false when nothing is parked (or toolCallId mismatches).
 */
export function resolveParkedAskQuestion(
  chatId: string,
  result: AskQuestionToolResult,
  toolCallId?: string,
): boolean {
  const parked = parkedByChatId.get(chatId);
  if (!parked) return false;
  if (toolCallId && parked.toolCallId !== toolCallId) return false;
  parkedByChatId.delete(chatId);
  parked.resolve(stringifyAskQuestionResult(result));
  return true;
}

/** Cancel a parked question (stop_generation / turn abort). */
export function cancelParkedAskQuestion(chatId: string): boolean {
  return resolveParkedAskQuestion(chatId, { status: 'cancelled', answers: [] });
}

/** Test helper — drop all waiters. */
export function resetAskQuestionBridgeForTests(): void {
  for (const parked of parkedByChatId.values()) {
    parked.reject(new Error('ask_question bridge reset'));
  }
  parkedByChatId.clear();
}
