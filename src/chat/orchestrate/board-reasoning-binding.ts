/**
 * Resolve and propagate per-board reasoning / thinking overrides to planner + task chats.
 */

import {
  getComposerReasoningLevelOptions,
  normalizeReasoningAllowedOptions,
} from '../../lib/reasoning-effort.ts';
import { resolveSendCapabilities } from '../../providers/model-capabilities.ts';
import { findChatById } from '../../state/sessions.ts';
import type { Chat, ChatGroup, OrchestrateBoardState, ReasoningEffortOption } from '../../types.ts';
import type { ThinkingTriState } from '../../agents/thinking-types.ts';
import { resolveBoardModelBinding } from './board-model-binding.ts';

/** Collect every chat id linked to a board (planner, tasks, final test). */
export function listBoardLinkedChatIds(
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
): string[] {
  const ids = new Set<string>();
  const plannerId = plannerChat.id?.trim();
  if (plannerId) ids.add(plannerId);

  for (const task of board.tasks) {
    for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
      const id = chatId?.trim();
      if (id) ids.add(id);
    }
  }

  const finalChatId = board.finalTest?.chatId?.trim();
  if (finalChatId) ids.add(finalChatId);

  return [...ids];
}

/** Apply board reasoning overrides to one chat (clears chat fields when board inherits). */
export function applyBoardReasoningToChat(
  chat: Chat,
  board: OrchestrateBoardState,
): void {
  if (board.reasoningEffort !== undefined) {
    chat.reasoningEffort = board.reasoningEffort;
  } else {
    delete chat.reasoningEffort;
  }
  if (board.thinkingMode !== undefined) {
    chat.thinkingMode = board.thinkingMode;
  } else {
    delete chat.thinkingMode;
  }
}

/** Push board reasoning overrides to planner and every linked task chat. */
export function propagateBoardReasoningToChats(
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
): void {
  for (const chatId of listBoardLinkedChatIds(group, board, plannerChat)) {
    const chat = findChatById(chatId);
    if (!chat) continue;
    applyBoardReasoningToChat(chat, board);
  }
}

/** Drop board reasoning fields that the active model no longer supports. */
export function sanitizeBoardReasoningForModel(
  board: OrchestrateBoardState,
  plannerChat: Chat,
): void {
  const binding = resolveBoardModelBinding(plannerChat, board);
  if (!binding.modelId || !binding.providerId) return;

  const caps = resolveSendCapabilities(binding.providerId, binding.modelId);
  const allowed = normalizeReasoningAllowedOptions(caps?.reasoningAllowedOptions ?? []);
  const levels = getComposerReasoningLevelOptions(allowed);

  if (board.reasoningEffort && board.reasoningEffort !== 'off') {
    if (levels.length > 0 && !levels.includes(board.reasoningEffort)) {
      delete board.reasoningEffort;
    } else if (
      levels.length === 0 &&
      allowed.length > 0 &&
      !allowed.includes(board.reasoningEffort)
    ) {
      delete board.reasoningEffort;
    }
  }

  if (board.thinkingMode && board.thinkingMode !== 'inherit') {
    const supportsToggle =
      allowed.includes('off') && allowed.includes('on') && levels.length === 0;
    if (!supportsToggle && levels.length === 0 && caps?.reasoning === false) {
      delete board.thinkingMode;
    }
  }
}

export type BoardReasoningPatch = {
  reasoningEffort?: ReasoningEffortOption;
  thinkingMode?: ThinkingTriState;
  clearReasoningEffort?: boolean;
  clearThinkingMode?: boolean;
};

/** Merge a reasoning patch onto board state (used by header controls + actions). */
export function applyBoardReasoningPatch(
  board: OrchestrateBoardState,
  patch: BoardReasoningPatch,
): void {
  if (patch.clearReasoningEffort) {
    delete board.reasoningEffort;
  } else if (patch.reasoningEffort !== undefined) {
    board.reasoningEffort = patch.reasoningEffort;
  }

  if (patch.clearThinkingMode) {
    delete board.thinkingMode;
  } else if (patch.thinkingMode !== undefined) {
    board.thinkingMode = patch.thinkingMode;
  }
}
