/**
 * Embedded ask_question host for the first-run wizard "Meet Minnow" guide chat.
 */

import { findChatById, getActiveChat } from '../state/sessions';
import type { Chat } from '../types';

export const ONBOARDING_GUIDE_CHAT_COL_ID = 'onboardingChatCol';
export const ONBOARDING_GUIDE_QUESTIONS_ID = 'onboardingGuideQuestions';

let registeredGuideChatId: string | null = null;

/** Track the wizard guide chat so ask_question routes to the onboarding panel. */
export function registerOnboardingGuideChatId(chatId: string | null): void {
  registeredGuideChatId = chatId?.trim() || null;
}

function isGuideStepMounted(): boolean {
  return Boolean(document.getElementById(ONBOARDING_GUIDE_CHAT_COL_ID));
}

function resolveGuideChat(forChatId?: string): Chat | null {
  if (!isGuideStepMounted()) return null;

  const targetChatId = forChatId?.trim() || getActiveChat().id;
  const chat = findChatById(targetChatId) ?? getActiveChat();
  if (registeredGuideChatId && chat.id !== registeredGuideChatId) return null;
  if (chat.modeId !== 'onboarding') return null;
  return chat;
}

/** True while the wizard guide step owns the chat surface instead of workspace bubbles. */
export function isOnboardingGuideSuppressingChatDom(chatId?: string): boolean {
  return resolveGuideChat(chatId) != null;
}

/** Embedded ask_question host during the Meet Minnow onboarding step. */
export function resolveOnboardingGuideQuestionHost(
  forChatId?: string,
): HTMLElement | null {
  const chat = resolveGuideChat(forChatId);
  if (!chat) return null;

  const host = document.getElementById(ONBOARDING_GUIDE_QUESTIONS_ID);
  if (host instanceof HTMLElement) {
    host.hidden = false;
    return host;
  }
  return null;
}
