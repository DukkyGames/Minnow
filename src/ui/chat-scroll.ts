/**
 * Chat viewport scroll: stick-to-bottom while streaming (80px threshold; terminal uses 24px).
 */

import { isChatAppForeground } from './chat-mount';
import { isDesktopChatActive } from '../os/desktop-state';
import { getForegroundAppId } from '../os/instances';

/** Distance from bottom that still counts as "pinned" (larger than terminal — more padding in .chat-area). */
export const CHAT_PIN_THRESHOLD_PX = 80;

export const CHAT_JUMP_CHIP_ID = 'chatJumpLatest';
export const CHAT_APP_JUMP_CHIP_ID = 'chatAppJumpLatest';

let stickToBottom = true;
let chatAreaEl: HTMLElement | null = null;
let jumpChipEl: HTMLButtonElement | null = null;
let chatAppJumpChipEl: HTMLButtonElement | null = null;
const BOARD_INIT_SPLIT_CHAT_TESTID = 'boardInitSplitChat';

/** Scroll container for messages: split bottom pane during board_init, else #chatArea. */
export function getChatScrollRoot(): HTMLElement | null {
  const splitPane = document.querySelector(
    `[data-testid="${BOARD_INIT_SPLIT_CHAT_TESTID}"]`,
  ) as HTMLElement | null;
  if (splitPane) return splitPane;
  if (isDesktopChatActive() && getForegroundAppId() !== 'code') {
    return document.querySelector('.mn-os-chat-transcript') ?? chatAreaEl;
  }
  if (isChatAppForeground()) {
    return document.getElementById('chatAppArea') ?? chatAreaEl;
  }
  return chatAreaEl;
}

function onChatScrollTargetScroll(): void {
  const root = getChatScrollRoot();
  if (!root) return;
  stickToBottom = isChatAtBottom(root);
  updateJumpChipVisibility();
}

/** True when scroll position is within the pin threshold of the bottom. */
export function isChatAtBottom(el?: HTMLElement): boolean {
  const area = el ?? getChatScrollRoot();
  if (!area) return true;
  const distance = area.scrollHeight - area.scrollTop - area.clientHeight;
  return distance <= CHAT_PIN_THRESHOLD_PX;
}

/** Board view replaces chat scroll UX; jump chip is chat-only. */
function isBoardViewChromeActive(): boolean {
  return (
    document.getElementById('mainColumn')?.classList.contains('main-column--board-view') ??
    false
  );
}

/** Jump chip for the active transcript surface (Code vs Chat app). */
function getActiveJumpChip(): HTMLButtonElement | null {
  if (isChatAppForeground()) return chatAppJumpChipEl;
  return jumpChipEl;
}

function updateJumpChipVisibility(): void {
  const scrollRoot = getChatScrollRoot();
  const chip = getActiveJumpChip();
  if (!chip || !scrollRoot) return;
  if (isBoardViewChromeActive()) {
    jumpChipEl?.classList.add('hidden');
    chatAppJumpChipEl?.classList.add('hidden');
    return;
  }
  const hasOverflow = scrollRoot.scrollHeight > scrollRoot.clientHeight;
  const show = hasOverflow && !stickToBottom;
  jumpChipEl?.classList.toggle('hidden', isChatAppForeground() || !show);
  chatAppJumpChipEl?.classList.toggle('hidden', !isChatAppForeground() || !show);
}

/** Programmatic scroll without CSS smooth lag during rapid stream updates. */
function applyInstantScroll(area: HTMLElement, scrollTop: number): void {
  const prev = area.style.scrollBehavior;
  area.style.scrollBehavior = 'auto';
  area.scrollTop = scrollTop;
  requestAnimationFrame(() => {
    if (prev) area.style.scrollBehavior = prev;
    else area.style.removeProperty('scroll-behavior');
  });
}

/** Scroll to tail only when the user is pinned near the bottom. */
export function scrollChatIfPinned(): void {
  const root = getChatScrollRoot();
  if (!root || !stickToBottom) {
    updateJumpChipVisibility();
    return;
  }
  applyInstantScroll(root, root.scrollHeight);
  updateJumpChipVisibility();
}

/** Force scroll to tail and re-enable auto-follow. */
export function scrollChatToBottom(): void {
  const root = getChatScrollRoot();
  if (!root) return;
  stickToBottom = true;
  applyInstantScroll(root, root.scrollHeight);
  updateJumpChipVisibility();
}

/** Re-pin without scrolling (e.g. before a new stream shell). */
export function pinChatScroll(): void {
  stickToBottom = true;
  updateJumpChipVisibility();
}

export function isChatScrollPinned(): boolean {
  return stickToBottom;
}

/** Re-evaluate jump chip after board/chat chrome toggles (call from view-mode sync). */
export function refreshChatJumpChipVisibility(): void {
  updateJumpChipVisibility();
}

/** Bind scroll listener on the board-init split chat pane (idempotent). */
export function bindBoardInitSplitChatScroll(): void {
  const pane = document.querySelector(
    `[data-testid="${BOARD_INIT_SPLIT_CHAT_TESTID}"]`,
  ) as HTMLElement | null;
  if (!pane || pane.dataset.chatScrollBound === '1') return;
  pane.dataset.chatScrollBound = '1';
  pane.addEventListener('scroll', onChatScrollTargetScroll, { passive: true });
}

/** Wire scroll listeners on Code and Chat transcript roots (call once from main). */
function bindJumpChip(chip: HTMLButtonElement | null): void {
  chip?.addEventListener('click', () => {
    scrollChatToBottom();
  });
}

export function initChatScroll(): void {
  chatAreaEl = document.getElementById('chatArea');
  jumpChipEl = document.getElementById(CHAT_JUMP_CHIP_ID) as HTMLButtonElement | null;
  chatAppJumpChipEl = document.getElementById(CHAT_APP_JUMP_CHIP_ID) as HTMLButtonElement | null;

  chatAreaEl?.addEventListener('scroll', onChatScrollTargetScroll, { passive: true });
  const chatAppArea = document.getElementById('chatAppArea');
  if (chatAppArea && chatAppArea.dataset.chatScrollBound !== '1') {
    chatAppArea.dataset.chatScrollBound = '1';
    chatAppArea.addEventListener('scroll', onChatScrollTargetScroll, { passive: true });
  }

  bindJumpChip(jumpChipEl);
  bindJumpChip(chatAppJumpChipEl);

  bindBoardInitSplitChatScroll();
  updateJumpChipVisibility();
}
