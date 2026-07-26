/**
 * When the Session Engine parks on ask_question, open the existing question strip
 * from the soft-published `chat.pendingAskQuestion` hint and resume via answer_question.
 */

import { reportBackgroundError } from '../boot/report-background-error';
import { isServerEngineEnabled } from '../state/server-engine-flag';
import { dispatchAnswerQuestion } from '../state/session-commands';
import { sessionState } from '../state/sessions';
import { enqueueAskQuestion } from '../tools/ask-question-queue';
import type { AskQuestionArgs, AskQuestionToolResult } from '../tools/ask-question-types';

/** Keys already showing (or answering) so SSE re-publish does not double-open. */
const activeKeys = new Set<string>();

function pendingKey(chatId: string, toolCallId: string): string {
  return `${chatId}:${toolCallId}`;
}

/**
 * Scan session chats for pendingAskQuestion and drive the existing ask UI.
 * Safe to call after every remote session reconcile / stream mirror sync.
 */
export function syncEngineAskQuestionUi(): void {
  if (!isServerEngineEnabled() || !sessionState?.chats) return;

  for (const chat of sessionState.chats) {
    const pending = chat.pendingAskQuestion;
    if (!pending?.toolCallId || !pending.args?.questions?.length) continue;
    const key = pendingKey(chat.id, pending.toolCallId);
    if (activeKeys.has(key)) continue;
    activeKeys.add(key);
    void driveAskQuestion(chat.id, pending.toolCallId, pending.args as AskQuestionArgs, key);
  }
}

async function driveAskQuestion(
  chatId: string,
  toolCallId: string,
  args: AskQuestionArgs,
  key: string,
): Promise<void> {
  let result: AskQuestionToolResult = { status: 'cancelled', answers: [] };
  try {
    const content = await enqueueAskQuestion(args, {}, chatId);
    try {
      result = JSON.parse(content) as AskQuestionToolResult;
    } catch {
      result = { status: 'cancelled', answers: [] };
    }
    await dispatchAnswerQuestion({ chatId, toolCallId, result });
  } catch (err) {
    reportBackgroundError('engine-ask-question-mirror', err);
    try {
      await dispatchAnswerQuestion({
        chatId,
        toolCallId,
        result: { status: 'cancelled', answers: [] },
      });
    } catch (answerErr) {
      reportBackgroundError('engine-ask-question-answer', answerErr);
    }
  } finally {
    activeKeys.delete(key);
  }
}
