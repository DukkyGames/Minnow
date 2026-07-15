/**
 * Notification producer when ask_question UI opens while the user is not watching.
 */

import {
  isOrchestratePlanScreenMounted,
  isOrchestratePlanScreenOwningChat,
  isOrchestratePlanScreenSuspended,
} from '../ui/orchestrate-plan-screen';
import { isPromptHostShellVisible, isPromptHostVisible } from '../ui/prompt-host-resolve';
import { getForegroundAppId, getOsView } from '../os/instances';
import { findChatById, getActiveChat } from '../state/sessions';
import type { AskQuestionArgs } from '../tools/ask-question-types';
import { appIdForChat } from './app-for-chat';
import { truncatePreview } from './preview';
import { pushNotification } from './push';

const PLAN_SCREEN_QUESTIONS_HOST_ID = 'orchestratePlanScreenQuestions';

/**
 * True when the question strip is mounted in a host the user can see for this chat.
 */
export function isAskQuestionVisibleToUser(
  chatId: string,
  host: HTMLElement | null,
  embedded: boolean,
): boolean {
  if (!host) return false;
  if (getActiveChat().id !== chatId) return false;

  const isPlanQuestionsHost =
    embedded && host.id === PLAN_SCREEN_QUESTIONS_HOST_ID;

  if (isPlanQuestionsHost) {
    return (
      isOrchestratePlanScreenMounted() &&
      !isOrchestratePlanScreenSuspended() &&
      isOrchestratePlanScreenOwningChat(chatId)
    );
  }

  if (!isPromptHostVisible(host)) return false;

  // Code column hosts are hidden while the desktop launcher is foreground.
  if (getOsView() === 'desktop' && getForegroundAppId() !== 'code') {
    return false;
  }

  return isPromptHostShellVisible(host);
}

/** True when an ask_question prompt should surface in the menubar inbox. */
export function shouldNotifyForAskQuestion(
  chatId: string,
  host: HTMLElement | null,
  embedded: boolean,
): boolean {
  return !isAskQuestionVisibleToUser(chatId, host, embedded);
}

/** Build a compact preview from the first question (and count when batched). */
export function buildAskQuestionPreview(args: AskQuestionArgs): string {
  const first = args.questions[0];
  if (!first?.prompt?.trim()) return 'Answer required';
  const prompt = truncatePreview(first.prompt);
  const extra = args.questions.length - 1;
  if (extra > 0) return `${prompt} (+${extra} more)`;
  return prompt;
}

/** Push inbox row + bell/sound when ask_question opens off-screen (e.g. Super Plan on desktop). */
export function notifyAskQuestionShown(
  chatId: string,
  args: AskQuestionArgs,
  host: HTMLElement | null,
  embedded: boolean,
): void {
  if (!shouldNotifyForAskQuestion(chatId, host, embedded)) return;

  const chat = findChatById(chatId);
  if (!chat) return;

  const title = chat.name?.trim() || 'Chat';
  const body = buildAskQuestionPreview(args);
  const preview = args.title?.trim() ? `${args.title.trim()} — ${body}` : body;
  const questionIds = args.questions.map((q) => q.id).join(',');

  pushNotification({
    kind: 'chat_question',
    title,
    preview,
    chatId,
    appId: appIdForChat(chat),
    dedupeKey: `ask:${chatId}:${questionIds}`,
  });
}
