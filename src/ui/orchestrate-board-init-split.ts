/**
 * Transient Orchestrate board-init split layout: Kanban (or onboarding) on top,
 * streaming chat + tool calls below. Active only during board_init kickoff streams.
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

const SPLIT_CLASS = 'main-column--orchestrate-init-split';
const SPLIT_ROOT_CLASS = 'board-init-split';
const BOARD_PANE_TESTID = 'boardInitSplitBoard';
const CHAT_PANE_TESTID = 'boardInitSplitChat';

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
 * True while the parent orchestrator stream is initializing or re-parsing the board
 * and the user should see the split layout (board top, chat bottom).
 */
export function isOrchestrateBoardInitSplitActive(chat: Chat): boolean {
  if (normalizeModeId(chat.modeId) !== 'orchestrate') return false;
  if (!isChatStreaming(chat.id)) return false;
  if (!isOrchestrateBoardViewActive() && !isOrchestrateInitSplitChromeActive()) {
    return false;
  }
  const group = getBoardGroupForChat(chat);
  const board = group?.orchestrateBoard;
  if (!board) return true;
  return lastUserMessageMatchesBoardKickoff(chat);
}

/** Whether split chrome is mounted on #mainColumn / #chatArea. */
export function isOrchestrateInitSplitChromeActive(): boolean {
  return (
    document.getElementById('mainColumn')?.classList.contains(SPLIT_CLASS) ?? false
  );
}

/** Chat transcript mount: split bottom pane or full #chatArea. */
export function getOrchestrateChatMountElement(): HTMLElement {
  const pane = document.querySelector(
    `[data-testid="${CHAT_PANE_TESTID}"]`,
  ) as HTMLElement | null;
  if (pane) return pane;
  return document.getElementById('chatArea')!;
}

/** Board shell mount: split top pane or full #chatArea. */
export function getOrchestrateBoardMountElement(): HTMLElement {
  const pane = document.querySelector(
    `[data-testid="${BOARD_PANE_TESTID}"]`,
  ) as HTMLElement | null;
  if (pane) return pane;
  return document.getElementById('chatArea')!;
}

function ensureSplitHost(area: HTMLElement): void {
  if (area.querySelector(`:scope > .${SPLIT_ROOT_CLASS}`)) return;
  area.replaceChildren();
  const split = document.createElement('div');
  split.className = SPLIT_ROOT_CLASS;
  const boardPane = document.createElement('div');
  boardPane.className = 'board-init-split__board';
  boardPane.dataset.testid = BOARD_PANE_TESTID;
  const chatPane = document.createElement('div');
  chatPane.className = 'board-init-split__chat';
  chatPane.dataset.testid = CHAT_PANE_TESTID;
  split.appendChild(boardPane);
  split.appendChild(chatPane);
  area.appendChild(split);
}

function teardownSplitHost(area: HTMLElement): void {
  const split = area.querySelector(`:scope > .${SPLIT_ROOT_CLASS}`);
  if (!split) return;
  area.replaceChildren();
}

function openBoardGroupForInitSplit(chat: Chat): void {
  const group =
    getActiveBoardGroup() ?? getBoardGroupForChat(chat) ?? getOrCreateBoardGroup(chat);
  group.viewMode = 'board';
  if (sessionState) {
    sessionState.activeBoardGroupId = group.id;
  }
}

/**
 * Mount or tear down init-split DOM and sync main-column classes.
 * Call on stream start/end and when board view enters init streaming.
 */
export function syncOrchestrateInitSplitChrome(chat?: Chat): void {
  const active = chat ?? getActiveChat();
  const shouldSplit = isOrchestrateBoardInitSplitActive(active);
  const mainColumn = document.getElementById('mainColumn');
  mainColumn?.classList.toggle(SPLIT_CLASS, shouldSplit);

  const area = document.getElementById('chatArea');
  if (!area) return;

  if (shouldSplit) {
    openBoardGroupForInitSplit(active);
    ensureSplitHost(area);
    syncBoardViewChrome();
    void import('./orchestrate-board').then((m) => {
      const group =
        getActiveBoardGroup() ??
        getBoardGroupForChat(active) ??
        getOrCreateBoardGroup(active);
      m.renderBoardView(group);
      m.refreshBoardOnboardingIfMounted();
    });
    return;
  }

  const hadSplit = Boolean(area.querySelector(`:scope > .${SPLIT_ROOT_CLASS}`));
  teardownSplitHost(area);
  syncBoardViewChrome();
  if (hadSplit && isOrchestrateBoardViewActive()) {
    const group = getActiveBoardGroup();
    if (group) {
      void import('./orchestrate-board').then((m) => m.renderBoardView(group));
    }
  }
}

/** Clear split chrome between happy-dom test runs. */
export function resetOrchestrateInitSplitForTests(): void {
  document.getElementById('mainColumn')?.classList.remove(SPLIT_CLASS);
  const area = document.getElementById('chatArea');
  if (area) teardownSplitHost(area);
}
