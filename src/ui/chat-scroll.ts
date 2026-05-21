/**
 * Chat viewport scroll: stick-to-bottom while streaming (80px threshold; terminal uses 24px).
 */

/** Distance from bottom that still counts as "pinned" (larger than terminal — more padding in .chat-area). */
export const CHAT_PIN_THRESHOLD_PX = 80;

export const CHAT_JUMP_CHIP_ID = 'chatJumpLatest';

let stickToBottom = true;
let chatAreaEl: HTMLElement | null = null;
let jumpChipEl: HTMLButtonElement | null = null;

/** True when scroll position is within the pin threshold of the bottom. */
export function isChatAtBottom(el?: HTMLElement): boolean {
  const area = el ?? chatAreaEl;
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

function updateJumpChipVisibility(): void {
  if (!jumpChipEl || !chatAreaEl) return;
  if (isBoardViewChromeActive()) {
    jumpChipEl.classList.add('hidden');
    return;
  }
  const hasOverflow = chatAreaEl.scrollHeight > chatAreaEl.clientHeight;
  const show = hasOverflow && !stickToBottom;
  jumpChipEl.classList.toggle('hidden', !show);
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
  if (!chatAreaEl || !stickToBottom) {
    updateJumpChipVisibility();
    return;
  }
  applyInstantScroll(chatAreaEl, chatAreaEl.scrollHeight);
  updateJumpChipVisibility();
}

/** Force scroll to tail and re-enable auto-follow. */
export function scrollChatToBottom(): void {
  if (!chatAreaEl) return;
  stickToBottom = true;
  applyInstantScroll(chatAreaEl, chatAreaEl.scrollHeight);
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

/** Wire #chatArea scroll listener and Jump to latest chip (call once from main). */
export function initChatScroll(): void {
  chatAreaEl = document.getElementById('chatArea');
  jumpChipEl = document.getElementById(CHAT_JUMP_CHIP_ID) as HTMLButtonElement | null;

  chatAreaEl?.addEventListener(
    'scroll',
    () => {
      if (!chatAreaEl) return;
      stickToBottom = isChatAtBottom(chatAreaEl);
      updateJumpChipVisibility();
    },
    { passive: true },
  );

  jumpChipEl?.addEventListener('click', () => {
    scrollChatToBottom();
  });

  updateJumpChipVisibility();
}
