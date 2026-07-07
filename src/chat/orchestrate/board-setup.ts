/**
 * Orchestrate board setup detection — plan selected but no board store yet (MIN-340).
 */

import { normalizeModeId } from '../modes/types';
import { getBoardGroupForChat } from '../../state/chat-groups';
import type { Chat, ChatGroup } from '../../types';
import {
  isBoardGitSetupPromptActive,
  isBoardKickoffInProgress,
  isBoardOnboardingGitSetupActive,
} from '../../ui/orchestrate-board-onboarding-state';

/** True when a folder has a plan path but board_init has not created a store yet. */
export function isBoardSetupIncomplete(group: ChatGroup): boolean {
  if (group.orchestrateBoard) return false;
  return Boolean(group.orchestratePlanPath?.trim());
}

/** True while git preflight, git skill, or board_init kickoff is in flight. */
export function isBoardOnboardingBusy(): boolean {
  return (
    isBoardKickoffInProgress() ||
    isBoardOnboardingGitSetupActive() ||
    isBoardGitSetupPromptActive()
  );
}

/** Board folder linked to this chat when setup is still incomplete. */
export function getIncompleteBoardSetupGroup(chat: Chat): ChatGroup | undefined {
  const group = getBoardGroupForChat(chat);
  if (!group || !isBoardSetupIncomplete(group)) return undefined;
  return group;
}

/** Show the chat-view return banner while setup is incomplete and board view is dismissed. */
export function shouldShowBoardSetupReturnBanner(chat: Chat): boolean {
  if (normalizeModeId(chat.modeId) !== 'orchestrate') return false;
  const group = getIncompleteBoardSetupGroup(chat);
  if (!group) return false;
  return group.viewMode !== 'board';
}

/** Human label for hub/sidebar status chips during incomplete setup. */
export function boardSetupStatusLabel(group: ChatGroup): string {
  if (!isBoardSetupIncomplete(group)) return 'Board';
  return isBoardOnboardingBusy() ? 'Setting up' : 'Setup';
}
