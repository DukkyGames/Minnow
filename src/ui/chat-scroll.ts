import { isChatAppForeground } from './chat-mount';
import { OB_CHAT_SCROLL_SELECTOR } from './orchestrate-board-chat-state';

/** Distance from bottom that still counts as "pinned" (larger than terminal — more padding in .chat-area). */
export const CHAT_PIN_THRESHOLD_PX = 80;

export const CHAT_JUMP_CHIP_ID = 'chatJumpLatest';
export const CHAT_APP_JUMP_CHIP_ID = 'chatAppJumpLatest';

let stickToBottom = true;
/** Ignore scroll events triggered by our own scrollTop writes during stream follow. */
let programmaticScroll = false;
/** Only the newest scheduled release clears the flag — overlapping scrolls must not unpin (MIN-793). */
let programmaticScrollToken = 0;
let chatAreaEl: HTMLElement | null = null;
let jumpChipEl: HTMLButtonElement | null = null;
let chatAppJumpChipEl: HTMLButtonElement | null = null;
const BOARD_INIT_SPLIT_CHAT_TESTID = 'boardInitSplitChat';
const DESKTOP_CHAT_TRANSCRIPT_SELECTOR = '.mn-os-chat-transcript';

/** Cached scroll root for the current animation frame (MIN-584 layout thrash). */
let frameCachedScrollRoot: HTMLElement | null | undefined;
let frameCacheHandle = 0;

/** Saved scroll position before a transcript rebuild (distance from bottom + pin state). */
export interface ChatScrollAnchor {
  pinned: boolean;
  distanceFromBottom: number;
}

/** Drop the per-frame scroll-root cache (chat switch, board/chat chrome). */
export function invalidateChatScrollRootCache(): void {
  frameCachedScrollRoot = undefined;
  if (frameCacheHandle && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(frameCacheHandle);
  }
  frameCacheHandle = 0;
}

function resolveChatScrollRoot(): HTMLElement | null {
  const boardChatPane = document.querySelector<HTMLElement>(OB_CHAT_SCROLL_SELECTOR);
  if (boardChatPane) return boardChatPane;
  const splitPane = document.querySelector(
    `[data-testid="${BOARD_INIT_SPLIT_CHAT_TESTID}"]`,
  ) as HTMLElement | null;
  if (splitPane) return splitPane;
  if (isChatAppForeground()) {
    return document.getElementById('chatAppArea') ?? chatAreaEl;
  }
  return chatAreaEl;
}

/** Scroll container for messages: Orchestrate chat pane, split bottom pane, else #chatArea. */
export function getChatScrollRoot(): HTMLElement | null {
  if (typeof requestAnimationFrame !== 'function') {
    return resolveChatScrollRoot();
  }
  if (frameCachedScrollRoot !== undefined) return frameCachedScrollRoot;
  const root = resolveChatScrollRoot();
  frameCachedScrollRoot = root;
  frameCacheHandle = requestAnimationFrame(() => {
    frameCacheHandle = 0;
    frameCachedScrollRoot = undefined;
  });
  return root;
}

function onChatScrollTargetScroll(boundEl: HTMLElement): void {
  if (programmaticScroll) return;
  const root = getChatScrollRoot();
  if (!root || boundEl !== root) return;
  stickToBottom = isChatAtBottom(root);
  updateJumpChipVisibility();
}

/** Release auto-follow immediately when the user wheels up (before the next stream tick). */
function onChatScrollTargetWheel(ev: WheelEvent, boundEl: HTMLElement): void {
  const root = getChatScrollRoot();
  if (!root || boundEl !== root) return;
  if (ev.deltaY >= 0) return;
  stickToBottom = false;
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
  programmaticScroll = true;
  programmaticScrollToken += 1;
  const token = programmaticScrollToken;
  area.style.scrollBehavior = 'auto';
  area.scrollTop = scrollTop;
  requestAnimationFrame(() => {
    // A later scroll is still landing; releasing here would read it as a user scroll.
    if (token !== programmaticScrollToken) return;
    programmaticScroll = false;
    if (prev) area.style.scrollBehavior = prev;
    else area.style.removeProperty('scroll-behavior');
  });
}

/** Scroll to tail only when the user is pinned near the bottom. */
export function scrollChatIfPinned(): void {
  if (!stickToBottom) {
    updateJumpChipVisibility();
    return;
  }
  const root = getChatScrollRoot();
  if (!root) {
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

/** Snapshot scroll pin + distance from bottom before rebuilding the transcript. */
export function captureChatScrollAnchor(): ChatScrollAnchor | null {
  const root = getChatScrollRoot();
  if (!root) return null;
  const distanceFromBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
  return {
    pinned: distanceFromBottom <= CHAT_PIN_THRESHOLD_PX,
    distanceFromBottom,
  };
}

/** Restore scroll after a transcript rebuild; follow tail only when the user was pinned. */
export function restoreChatScrollAnchor(anchor: ChatScrollAnchor | null): void {
  if (!anchor) return;
  const root = getChatScrollRoot();
  if (!root) return;
  if (anchor.pinned) {
    scrollChatToBottom();
    return;
  }
  stickToBottom = false;
  const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
  const target = Math.max(
    0,
    Math.min(maxScroll, root.scrollHeight - root.clientHeight - anchor.distanceFromBottom),
  );
  applyInstantScroll(root, target);
  updateJumpChipVisibility();
}

function bindScrollTarget(el: HTMLElement | null): void {
  if (!el || el.dataset.chatScrollBound === '1') return;
  el.dataset.chatScrollBound = '1';
  el.addEventListener('scroll', () => onChatScrollTargetScroll(el), { passive: true });
  el.addEventListener('wheel', (ev) => onChatScrollTargetWheel(ev, el), { passive: true });
}

/** Bind scroll listener on the desktop chat transcript (idempotent; safe before/after OS mount). */
export function bindDesktopChatTranscriptScroll(): void {
  bindScrollTarget(
    document.querySelector(DESKTOP_CHAT_TRANSCRIPT_SELECTOR) as HTMLElement | null,
  );
}

/** Bind scroll listener on the embedded Orchestrate board chat (idempotent; call after mount). */
export function bindOrchestrateBoardChatScroll(): void {
  invalidateChatScrollRootCache();
  bindScrollTarget(document.querySelector<HTMLElement>(OB_CHAT_SCROLL_SELECTOR));
}

/** Bind scroll listener on the board-init split chat pane (idempotent). */
export function bindBoardInitSplitChatScroll(): void {
  invalidateChatScrollRootCache();
  bindScrollTarget(
    document.querySelector(
      `[data-testid="${BOARD_INIT_SPLIT_CHAT_TESTID}"]`,
    ) as HTMLElement | null,
  );
}

/** Wire scroll listeners on Code and Chat transcript roots (call once from main). */
function bindJumpChip(chip: HTMLButtonElement | null): void {
  chip?.addEventListener('click', () => {
    scrollChatToBottom();
  });
}

export function initChatScroll(): void {
  invalidateChatScrollRootCache();
  chatAreaEl = document.getElementById('chatArea');
  jumpChipEl = document.getElementById(CHAT_JUMP_CHIP_ID) as HTMLButtonElement | null;
  chatAppJumpChipEl = document.getElementById(CHAT_APP_JUMP_CHIP_ID) as HTMLButtonElement | null;

  bindScrollTarget(chatAreaEl);
  bindScrollTarget(document.getElementById('chatAppArea'));
  bindDesktopChatTranscriptScroll();

  bindJumpChip(jumpChipEl);
  bindJumpChip(chatAppJumpChipEl);

  bindBoardInitSplitChatScroll();
  updateJumpChipVisibility();
}
