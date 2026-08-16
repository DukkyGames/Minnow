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

/** Test override: null uses CSS.supports, boolean forces the JS or CSS path. */
let fieldSizingSupportOverride: boolean | null = null;

function composerMaxHeightPx(): number {
  return Math.floor(window.innerHeight * (COMPOSER_MAX_HEIGHT_VH / 100));
}

/** True when CSS `field-sizing: content` can grow the composer without JS layout. */
export function composerFieldSizingSupported(): boolean {
  if (fieldSizingSupportOverride != null) return fieldSizingSupportOverride;
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('field-sizing', 'content')
  );
}

/** @internal Force field-sizing detection in unit tests (`null` restores CSS.supports). */
export function setComposerFieldSizingSupportedForTests(value: boolean | null): void {
  fieldSizingSupportOverride = value;
}

/** Drop leftover inline height so CSS field-sizing (or min-height) can take over. */
function clearInlineComposerHeight(el: HTMLTextAreaElement): void {
  if (el.style.height) el.style.height = '';
}

/**
 * Grow #msgInput to fit lines.
 * Electron 43+ uses CSS field-sizing, so this is a no-op (avoids height:auto
 * reflow on every keystroke, which lagged glyph paint on macOS).
 * Fallback engines skip height:auto unless the box must shrink.
 */
export function autoResize(el: HTMLTextAreaElement): void {
  if (composerFieldSizingSupported()) {
    clearInlineComposerHeight(el);
    return;
  }

  const maxPx = composerMaxHeightPx();
  const minPx = COMPOSER_MIN_HEIGHT_PX;
  const current = el.offsetHeight;

  // Growing: overflowing content — set the new height without collapsing first.
  if (el.scrollHeight > el.clientHeight + 1) {
    const next = Math.min(Math.max(el.scrollHeight, minPx), maxPx);
    if (Math.abs(next - current) > 0.5) {
      el.style.height = `${next}px`;
    }
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
    return;
  }

  // Single-line at the floor: do not set height:auto (that reflows the chat column).
  if (current <= minPx + 1) {
    el.style.height = `${minPx}px`;
    el.style.overflowY = 'hidden';
    return;
  }

  // Shrink path only (deleted a line). Textarea scrollHeight is often clamped
  // to clientHeight, so measuring natural height requires height:auto.
  el.style.overflowY = 'hidden';
  el.style.height = 'auto';
  const contentHeight = el.scrollHeight;
  if (contentHeight <= maxPx) {
    el.style.height = `${Math.max(contentHeight, minPx)}px`;
    el.style.overflowY = 'hidden';
    return;
  }
  el.style.height = `${maxPx}px`;
  el.style.overflowY = 'auto';
}

/** Wire Code composer keydown, resize, steer, and draft listeners (idempotent). */
export function initComposerInput(el: HTMLTextAreaElement): void {
  autoResize(el);
  initComposerSteerInputListener(el);
  if (el.dataset.composerKeydownWired !== '1') {
    el.dataset.composerKeydownWired = '1';
    el.addEventListener('keydown', handleKey);
    // field-sizing: content grows the box in the compositor; skip JS on input.
    if (!composerFieldSizingSupported()) {
      el.addEventListener('input', () => autoResize(el));
      window.addEventListener('resize', () => autoResize(el));
    }
  }
  void import('./composer-draft').then((m) => m.initComposerDraftListener(el));
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
