/**
 * Orchestrate mode: Chat / Board icon toggle in the top bar.
 */

import { streaming } from '../app-state';
import { normalizeModeId } from '../chat/modes/types';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { Chat } from '../types';
import { isComposerRecoveryBlocked } from './composer-send';

let toggleBtnEl: HTMLButtonElement | null = null;

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
  toggleBtnEl = null;
  renderChat = defaultRenderChat;
  const btn = document.getElementById('btnViewModeToggle');
  if (btn) {
    delete btn.dataset.initialized;
  }
  document.getElementById('mainColumn')?.classList.remove('main-column--board-view');
}

/** True when the active chat should render board UI instead of chat bubbles. */
export function isOrchestrateBoardViewActive(): boolean {
  const chat = getActiveChat();
  return (
    normalizeModeId(chat.modeId) === 'orchestrate' && chat.viewMode === 'board'
  );
}

/** Toggle main-column layout class: hides chat composer in board view. */
export function syncBoardViewChrome(): void {
  const mainColumn = document.getElementById('mainColumn');
  if (!mainColumn) return;
  mainColumn.classList.toggle(
    'main-column--board-view',
    isOrchestrateBoardViewActive(),
  );
}

function getToggleButton(): HTMLButtonElement | null {
  if (!toggleBtnEl) {
    toggleBtnEl = document.getElementById('btnViewModeToggle') as HTMLButtonElement | null;
  }
  return toggleBtnEl;
}

/** Whether the top-bar toggle can switch chat/board for this chat. */
function isViewModeToggleEnabled(chat: Chat): boolean {
  const mode = normalizeModeId(chat.modeId);
  const hasPlan = Boolean(chat.orchestratePlanPath?.trim());
  if (mode !== 'orchestrate' || !hasPlan) return false;
  if (streaming || isComposerRecoveryBlocked()) return false;
  return true;
}

/** Disables the top-bar toggle while streaming, recovery, or non-Orchestrate chat. */
export function refreshViewModeToggleDisabled(): void {
  const btn = getToggleButton();
  if (!btn) return;
  const chat = getActiveChat();
  btn.disabled = !isViewModeToggleEnabled(chat);
}

/**
 * Syncs top-bar icon toggle: disabled outside Orchestrate + plan; aria-pressed in board view.
 */
export function syncViewModeToggleFromActiveChat(): void {
  const btn = getToggleButton();
  if (!btn) return;

  const chat = getActiveChat();
  const mode = normalizeModeId(chat.modeId);
  const hasPlan = Boolean(chat.orchestratePlanPath?.trim());
  const boardActive = chat.viewMode === 'board';
  const enabled = isViewModeToggleEnabled(chat);

  btn.disabled = !enabled;
  btn.setAttribute('aria-pressed', boardActive ? 'true' : 'false');
  btn.classList.toggle('view-mode-toggle-btn--board-active', boardActive);

  if (mode !== 'orchestrate') {
    btn.setAttribute('aria-label', 'Board view');
    btn.title = 'Board view (Orchestrate mode only)';
  } else if (!hasPlan) {
    btn.setAttribute('aria-label', 'Board view');
    btn.title = 'Select a plan to use board view';
  } else if (boardActive) {
    btn.setAttribute('aria-label', 'Switch to chat view');
    btn.title = 'Chat view';
  } else {
    btn.setAttribute('aria-label', 'Switch to board view');
    btn.title = 'Board view';
  }

  syncBoardViewChrome();
}

function onViewToggleClick(): void {
  const btn = getToggleButton();
  if (!btn || btn.disabled) return;

  const chat = getActiveChat();
  if (!isViewModeToggleEnabled(chat)) return;

  chat.viewMode = chat.viewMode === 'board' ? 'chat' : 'board';
  touchChat(chat);
  scheduleSaveSessions();
  syncViewModeToggleFromActiveChat();
  renderChat(chat);
}

/** Wires the top-bar toggle and first sync (idempotent). */
export function initViewModeToggle(): void {
  const btn = getToggleButton();
  if (!btn || btn.dataset.initialized === 'true') return;
  btn.dataset.initialized = 'true';
  btn.addEventListener('click', onViewToggleClick);
  syncViewModeToggleFromActiveChat();
}
