/**
 * Transient Orchestrate board-init layout: full board onboarding loader (no chat split).
 * Chat still streams in the background; bubbles stay hidden until the user jumps to Chat view.
 */

import { normalizeModeId } from '../chat/modes/types';
import { isChatStreaming } from '../chat/streaming-state';
import {
  getActiveBoardGroup,
  getBoardGroupForChat,
  getOrCreateBoardGroup,
} from '../state/chat-groups';
import { getActiveChat, sessionState } from '../state/sessions';
import type { Chat } from '../types';
import {
  BOARD_BUILD_KICKOFF_MESSAGE,
  BOARD_ONBOARDING_KICKOFF_MESSAGE,
} from './orchestrate-board-kickoff';
import { isOrchestrateBoardViewActive, syncBoardViewChrome } from './view-mode-toggle';

/** True when the last user history row is a board parse/init kickoff. */
export function lastUserMessageMatchesBoardKickoff(chat: Chat): boolean {
  for (let i = chat.history.length - 1; i >= 0; i -= 1) {
    const msg = chat.history[i];
    if (!msg) continue;
    if (msg.role === 'user') {
      const content = String(msg.content).trim();
      return (
        content === BOARD_ONBOARDING_KICKOFF_MESSAGE ||
        content === BOARD_BUILD_KICKOFF_MESSAGE
      );
    }
    if (msg.role === 'assistant' || msg.role === 'tool') continue;
    break;
  }
  return false;
}

/**
 * True while the parent orchestrator stream is initializing the board
 * (no orchestrateBoard store yet, kickoff message in history).
 */
export function isOrchestrateBoardInitSplitActive(chat: Chat): boolean {
  if (normalizeModeId(chat.modeId) !== 'orchestrate') return false;
  if (!isChatStreaming(chat.id)) return false;
  if (!isOrchestrateBoardViewActive()) return false;
  const group = getBoardGroupForChat(chat);
  const board = group?.orchestrateBoard;
  if (board) return false;
  return lastUserMessageMatchesBoardKickoff(chat);
}

/** @deprecated Split chrome is no longer mounted; kept for loop.ts guards. */
export function isOrchestrateInitSplitChromeActive(): boolean {
  return false;
}

/** Chat transcript mount: always full #chatArea (init split removed). */
export function getOrchestrateChatMountElement(): HTMLElement {
  return document.getElementById('chatArea')!;
}

/** Board shell mount: always full #chatArea. */
export function getOrchestrateBoardMountElement(): HTMLElement {
  return document.getElementById('chatArea')!;
}

function openBoardGroupForInit(chat: Chat): void {
  const group =
    getActiveBoardGroup() ?? getBoardGroupForChat(chat) ?? getOrCreateBoardGroup(chat);
  group.viewMode = 'board';
  if (sessionState) {
    sessionState.activeBoardGroupId = group.id;
  }
}

/**
 * Refresh board onboarding during init streams; tear down legacy split DOM if present.
 */
export function syncOrchestrateInitSplitChrome(chat?: Chat): void {
  const active = chat ?? getActiveChat();
  const initActive = isOrchestrateBoardInitSplitActive(active);

  const area = document.getElementById('chatArea');
  const legacySplit = area?.querySelector(':scope > .board-init-split');
  if (legacySplit && area) {
    area.replaceChildren();
  }
  document.getElementById('mainColumn')?.classList.remove('main-column--orchestrate-init-split');

  if (initActive) {
    openBoardGroupForInit(active);
  }

  syncBoardViewChrome();

  if (!isOrchestrateBoardViewActive() && !initActive) return;

  void import('./orchestrate-board').then((m) => {
    const group =
      getActiveBoardGroup() ??
      getBoardGroupForChat(active) ??
      getOrCreateBoardGroup(active);
    m.renderBoardView(group);
    m.refreshBoardOnboardingIfMounted();
    if (group.orchestrateBoard) {
      m.refreshActiveBoardIfMounted();
    }
  });
}

/** Clear legacy split chrome between happy-dom test runs. */
export function resetOrchestrateInitSplitForTests(): void {
  document.getElementById('mainColumn')?.classList.remove('main-column--orchestrate-init-split');
  const area = document.getElementById('chatArea');
  const split = area?.querySelector(':scope > .board-init-split');
  if (split && area) {
    area.replaceChildren();
  }
}
