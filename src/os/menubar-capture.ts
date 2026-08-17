/**
 * Menubar quick-capture button.
 *
 * Sits beside the bell: the bell is where work reaches you, this is where work
 * leaves you. Pressing it opens the capture popover already holding whatever
 * the shell was showing, so the common case is type nothing, press Enter.
 *
 * It is also a drop target. Anything draggable in the shell can be dropped here
 * and becomes an issue — the reason the drag layer exists.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

import { iconHtml } from '../ui/icon';
import {
  dataTransferLooksCapturable,
  subscribeCaptureDrag,
} from '../ui/capture-drag';
import { openCaptureFromDrop, openQuickCapture } from '../ui/issue-capture';
import { isTypingTarget } from '../ui/a11y/typing-target';

/** Chord that opens capture from anywhere. `C` alone files inside Issues. */
export const QUICK_CAPTURE_CHORD = 'Alt + C';

const DROP_CLASS = 'is-drop-target';

function isQuickCaptureChord(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (!event.altKey) return false;
  // `event.key` under Alt varies by layout on some platforms; `code` does not.
  return event.code === 'KeyC' || event.key.toLowerCase() === 'c';
}

/**
 * Build the button and wire it up. Returns cleanup for menubar teardown.
 */
export function initMenubarCapture(btn: HTMLButtonElement): () => void {
  btn.type = 'button';
  btn.classList.add('mn-os-mb-icon', 'mn-os-mb-capture', 'mn-capture-target');
  btn.setAttribute('aria-label', `New issue (${QUICK_CAPTURE_CHORD})`);
  btn.title = `New issue — ${QUICK_CAPTURE_CHORD}. Drop anything here to file it.`;
  btn.innerHTML = iconHtml('plus', { size: 16 });

  const open = (): void => {
    openQuickCapture({ anchor: btn, restoreFocus: btn });
  };
  btn.addEventListener('click', open);

  const onDragOver = (event: DragEvent): void => {
    if (!dataTransferLooksCapturable(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
    btn.classList.add(DROP_CLASS);
  };
  const onDragLeave = (): void => btn.classList.remove(DROP_CLASS);
  const onDrop = (event: DragEvent): void => {
    btn.classList.remove(DROP_CLASS);
    if (!dataTransferLooksCapturable(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    openCaptureFromDrop(event.dataTransfer, { anchor: btn });
  };

  btn.addEventListener('dragover', onDragOver);
  btn.addEventListener('dragleave', onDragLeave);
  btn.addEventListener('drop', onDrop);

  // Highlight while any capture is in flight, so the target is obvious before
  // the pointer arrives rather than only once it is over the button.
  const unsubscribe = subscribeCaptureDrag((payload) => {
    btn.classList.toggle('is-drop-armed', payload !== null);
    if (!payload) btn.classList.remove(DROP_CLASS);
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    if (!isQuickCaptureChord(event)) return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    open();
  };
  document.addEventListener('keydown', onKeyDown);

  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKeyDown);
    btn.removeEventListener('click', open);
    btn.removeEventListener('dragover', onDragOver);
    btn.removeEventListener('dragleave', onDragLeave);
    btn.removeEventListener('drop', onDrop);
  };
}
