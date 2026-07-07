import { scrollChatIfPinned } from './chat-scroll';
import { handleComposerPromptHistoryKeydown } from './composer-prompt-history';
import { handleSkillPickerKeydown, isSkillPickerOpen } from './skill-picker';

import {
  handleComposerPrimaryAction,
  initComposerSteerInputListener,
  setComposerStreamingMode,
  setSendLoading,
} from './composer-send';

export {
  handleComposerPrimaryAction,
  initComposerSteerInputListener,
  setComposerStreamingMode,
  setSendLoading,
};
export type { ComposerStreamingMode } from './composer-send';

/** Composer grows with content; caps at 40vh then scrolls without a visible thumb. */
const COMPOSER_MIN_HEIGHT_PX = 44;
const COMPOSER_MAX_HEIGHT_VH = 40;

function composerMaxHeightPx(): number {
  return Math.floor(window.innerHeight * (COMPOSER_MAX_HEIGHT_VH / 100));
}

/** Grow #msgInput to fit lines; hide scrollbar until the viewport cap is reached. */
export function autoResize(el: HTMLTextAreaElement): void {
  const maxPx = composerMaxHeightPx();
  el.style.overflowY = 'hidden';
  el.style.height = 'auto';
  const contentHeight = el.scrollHeight;
  if (contentHeight <= maxPx) {
    el.style.height = `${Math.max(contentHeight, COMPOSER_MIN_HEIGHT_PX)}px`;
    el.style.overflowY = 'hidden';
    return;
  }
  el.style.height = `${maxPx}px`;
  el.style.overflowY = 'auto';
}

/** Wire composer resize listeners (input handler lives on the textarea in index.html). */
export function initComposerInput(el: HTMLTextAreaElement): void {
  autoResize(el);
  window.addEventListener('resize', () => autoResize(el));
  initComposerSteerInputListener();
}

export function handleKey(e: KeyboardEvent): void {
  if (handleSkillPickerKeydown(e)) return;
  const input = e.target;
  if (
    input instanceof HTMLTextAreaElement &&
    handleComposerPromptHistoryKeydown(e, input)
  ) {
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    if (isSkillPickerOpen()) return;
    e.preventDefault();
    handleComposerPrimaryAction();
  }
}

/** Scroll chat to tail when pinned near bottom (legacy name for stream hot paths). */
export function scrollBottom(): void {
  scrollChatIfPinned();
}
