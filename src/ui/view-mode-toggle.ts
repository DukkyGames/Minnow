/**
 * Orchestrate mode: separate Chat / Board view toggles.
 * Board → composer column above send; Chat → board header controls.
 */

import { normalizeModeId } from '../chat/modes/types';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { Chat } from '../types';

const BOARD_TOGGLE_ID = 'btnViewModeToggleBoard';
const CHAT_TOGGLE_ID = 'btnViewModeToggleChat';

let boardToggleEl: HTMLButtonElement | null = null;

function defaultRenderChat(chat: Chat): void {
  void import('./messages').then((m) => m.renderChatFromHistory(chat));
}

let renderChat: (chat: Chat) => void = defaultRenderChat;

/** Replace render callback in unit tests (restored by resetViewModeToggleForTests). */
export function setViewModeToggleRenderHandlerForTests(
  fn: ((chat: Chat) => void) | null,
): void {
  renderChat = fn ?? defaultRenderChat;
}

/** Clear cached DOM refs between happy-dom test runs. */
export function resetViewModeToggleForTests(): void {
  boardToggleEl = null;
  renderChat = defaultRenderChat;
  document.getElementById('mainColumn')?.classList.remove('main-column--board-view');
}

/** True when Orchestrate kanban is active (not bug tracker). */
export function isOrchestrateBoardViewActive(): boolean {
  const chat = getActiveChat();
  return (
    normalizeModeId(chat.modeId) === 'orchestrate' && chat.viewMode === 'board'
  );
}

/** True when any board view (Orchestrate or Bugs) replaces chat bubbles. */
export function isBoardViewActive(): boolean {
  const chat = getActiveChat();
  if (chat.viewMode !== 'board') return false;
  const mode = normalizeModeId(chat.modeId);
  return mode === 'orchestrate' || mode === 'debug';
}

/** Toggle main-column layout class: hides chat composer in board view. */
export function syncBoardViewChrome(): void {
  const mainColumn = document.getElementById('mainColumn');
  if (!mainColumn) return;
  mainColumn.classList.toggle('main-column--board-view', isBoardViewActive());
  void import('./chat-scroll').then((m) => m.refreshChatJumpChipVisibility());
}

function getBoardToggleButton(): HTMLButtonElement | null {
  if (!boardToggleEl) {
    boardToggleEl = document.getElementById(BOARD_TOGGLE_ID) as HTMLButtonElement | null;
  }
  return boardToggleEl;
}

function getChatToggleButton(): HTMLButtonElement | null {
  return document.getElementById(CHAT_TOGGLE_ID) as HTMLButtonElement | null;
}

/** Whether view toggles can switch chat/board for this chat. */
function isViewModeToggleEnabled(chat: Chat): boolean {
  const mode = normalizeModeId(chat.modeId);
  return mode === 'orchestrate' || mode === 'debug';
}

function boardToggleLabels(
  chat: Chat,
  boardActive: boolean,
): { ariaLabel: string; title: string } {
  const mode = normalizeModeId(chat.modeId);
  const hasPlan = Boolean(chat.orchestratePlanPath?.trim());

  if (mode !== 'orchestrate' && mode !== 'debug') {
    return {
      ariaLabel: 'Board view',
      title: 'Board view (Orchestrate or Bugs mode only)',
    };
  }
  if (mode === 'debug') {
    return boardActive
      ? { ariaLabel: 'Bug board view', title: 'Bug board view' }
      : { ariaLabel: 'Switch to bug board', title: 'Bug board view' };
  }
  if (!hasPlan) {
    return {
      ariaLabel: 'Switch to board view',
      title: 'Board view (select a plan in chat view for full board)',
    };
  }
  if (boardActive) {
    return { ariaLabel: 'Board view', title: 'Board view' };
  }
  return { ariaLabel: 'Switch to board view', title: 'Board view' };
}

function chatToggleLabels(
  chat: Chat,
  boardActive: boolean,
): { ariaLabel: string; title: string } {
  const mode = normalizeModeId(chat.modeId);
  const hasPlan = Boolean(chat.orchestratePlanPath?.trim());

  if (mode !== 'orchestrate' && mode !== 'debug') {
    return {
      ariaLabel: 'Chat view',
      title: 'Chat view (Orchestrate or Bugs mode only)',
    };
  }
  if (mode === 'debug') {
    return boardActive
      ? { ariaLabel: 'Switch to chat view', title: 'Chat view' }
      : { ariaLabel: 'Chat view', title: 'Chat view' };
  }
  if (boardActive && !hasPlan) {
    return {
      ariaLabel: 'Switch to chat view',
      title: 'Chat view (select a plan in the composer)',
    };
  }
  if (boardActive) {
    return { ariaLabel: 'Switch to chat view', title: 'Chat view' };
  }
  return { ariaLabel: 'Chat view', title: 'Chat view' };
}

function applyToggleButtonState(
  btn: HTMLButtonElement | null,
  enabled: boolean,
  labels: { ariaLabel: string; title: string },
  accentWhenActive: boolean,
): void {
  if (!btn) return;
  btn.disabled = !enabled;
  btn.setAttribute('aria-label', labels.ariaLabel);
  btn.title = labels.title;
  btn.classList.toggle('view-mode-toggle-btn--accent', accentWhenActive && enabled);
}

/** Disables composer/board toggles outside Orchestrate mode. */
export function refreshViewModeToggleDisabled(): void {
  syncViewModeToggleFromActiveChat();
}

/**
 * Syncs board (composer) and chat (board header) toggles from active chat state.
 */
export function syncViewModeToggleFromActiveChat(): void {
  const chat = getActiveChat();
  const boardActive = chat.viewMode === 'board';
  const enabled = isViewModeToggleEnabled(chat);

  applyToggleButtonState(
    getBoardToggleButton(),
    enabled && !boardActive,
    boardToggleLabels(chat, boardActive),
    false,
  );

  applyToggleButtonState(
    getChatToggleButton(),
    enabled && boardActive,
    chatToggleLabels(chat, boardActive),
    true,
  );

  const boardBtn = getBoardToggleButton();
  if (boardBtn) {
    const showBoardToggle = enabled && !boardActive;
    boardBtn.hidden = !showBoardToggle;
    boardBtn.classList.toggle('hidden', !showBoardToggle);
    wireViewToggleButton(boardBtn, 'board');
  }

  const chatBtn = getChatToggleButton();
  if (chatBtn) {
    wireViewToggleButton(chatBtn, 'chat');
  }

  syncBoardViewChrome();
}

/** Switch Orchestrate / debug chat between board and chat views (no-op if already there). */
export function setOrchestrateViewMode(next: 'chat' | 'board'): void {
  const chat = getActiveChat();
  if (!isViewModeToggleEnabled(chat)) return;
  if (chat.viewMode === next) return;

  chat.viewMode = next;
  touchChat(chat);
  scheduleSaveSessions();
  syncViewModeToggleFromActiveChat();
  if (normalizeModeId(chat.modeId) === 'debug') {
    if (next === 'board') {
      void import('./bug-board').then((m) => m.renderBugBoardView(chat));
    } else {
      renderChat(chat);
    }
    return;
  }
  renderChat(chat);
  void import('./orchestrate-plan-selector').then((m) =>
    m.syncOrchestratePlanStripFromActiveChat(),
  );
}

function wireViewToggleButton(
  btn: HTMLButtonElement,
  next: 'chat' | 'board',
): void {
  btn.onclick = () => setOrchestrateViewMode(next);
}

function createBoardChatViewToggleButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = CHAT_TOGGLE_ID;
  btn.className =
    'icon-btn view-mode-toggle-btn view-mode-toggle-btn--to-chat board-header__view-toggle';
  btn.setAttribute('aria-label', 'Switch to chat view');
  btn.title = 'Chat view';
  btn.disabled = true;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon-svg view-mode-toggle-btn__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  );
  svg.appendChild(path);
  btn.appendChild(svg);
  return btn;
}

/**
 * Ensure the chat-view toggle exists in board header controls and handles clicks.
 * Called on header build and on live board refresh (in-place kanban updates).
 */
export function ensureBoardChatViewToggle(controls: HTMLElement): void {
  let btn = controls.querySelector(
    `#${CHAT_TOGGLE_ID}`,
  ) as HTMLButtonElement | null;
  if (!btn) {
    btn = createBoardChatViewToggleButton();
    controls.appendChild(btn);
  }
  wireViewToggleButton(btn, 'chat');
}

/** Chat-view icon button for board header controls (recreated when header wires). */
export function appendBoardChatViewToggle(controls: HTMLElement): void {
  ensureBoardChatViewToggle(controls);
  syncViewModeToggleFromActiveChat();
}

/** Wires composer/board toggle clicks and first sync (idempotent). */
export function initViewModeToggle(): void {
  const boardBtn = getBoardToggleButton();
  if (boardBtn) wireViewToggleButton(boardBtn, 'board');
  syncViewModeToggleFromActiveChat();
}
