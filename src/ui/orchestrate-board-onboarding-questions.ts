/**
 * Embedded ask_question host for orchestrate board onboarding (git-setup skill, etc.).
 */

import { isChatStreaming } from '../chat/streaming-state';
import { getIncompleteBoardSetupGroup } from '../chat/orchestrate/board-setup';
import { findChatById, getActiveChat } from '../state/sessions';
import type { Chat } from '../types';
import {
  isBoardKickoffInProgress,
  isBoardOnboardingGitSetupActive,
} from './orchestrate-board-onboarding-state';
import { isBoardViewActive } from './view-mode-toggle';

export const BOARD_ONBOARDING_QUESTIONS_ID = 'boardOnboardingQuestions';

/** True when the guided board onboarding panel is mounted in the DOM. */
export function isBoardOnboardingMounted(): boolean {
  return Boolean(document.getElementById('boardOnboardingPlanSelect'));
}

function resolveOnboardingPlannerChat(forChatId?: string): Chat | null {
  const targetChatId = forChatId?.trim() || getActiveChat().id;
  const chat = findChatById(targetChatId) ?? getActiveChat();
  if (!getIncompleteBoardSetupGroup(chat)) return null;
  return chat;
}

/** True while board onboarding owns the main column instead of chat bubbles. */
export function isBoardOnboardingSuppressingChatDom(chatId?: string): boolean {
  if (!isBoardOnboardingMounted() || !isBoardViewActive()) return false;
  const chat = resolveOnboardingPlannerChat(chatId);
  if (!chat) return false;
  if (chatId?.trim() && chat.id !== chatId.trim()) return false;
  return true;
}

function isBoardOnboardingQuestionPhase(chat: Chat): boolean {
  return (
    isBoardOnboardingGitSetupActive() ||
    isBoardKickoffInProgress() ||
    isChatStreaming(chat.id)
  );
}

/**
 * Embedded ask_question host during board setup busy phases (git skill, kickoff stream).
 */
export function resolveBoardOnboardingQuestionHost(
  forChatId?: string,
): HTMLElement | null {
  if (!isBoardOnboardingMounted() || !isBoardViewActive()) return null;

  const chat = resolveOnboardingPlannerChat(forChatId);
  if (!chat || !isBoardOnboardingQuestionPhase(chat)) return null;

  const host = document.getElementById(BOARD_ONBOARDING_QUESTIONS_ID);
  if (host instanceof HTMLElement) {
    host.hidden = false;
    return host;
  }
  return null;
}
