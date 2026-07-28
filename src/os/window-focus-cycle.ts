/**
 * Alt+` window focus cycling.
 */

import { rememberFocusBeforeWindowActivate, restoreFocusAfterWindowsClosed } from './window-focus-memory';
import { windowManager } from './window-manager';

export { rememberFocusBeforeWindowActivate, restoreFocusAfterWindowsClosed };

let shellKeyboardBound = false;

/** Cycle floating OS windows forward (Alt+`). */
export function cycleOsWindowsForward(): void {
  const windows = windowManager.getWindows().filter((w) => !w.minimized);
  if (windows.length === 0) return;

  const focusedId = windowManager.getFocusedWindowId();
  const sorted = [...windows].sort((a, b) => a.zIndex - b.zIndex);
  const currentIndex = focusedId ? sorted.findIndex((w) => w.id === focusedId) : -1;
  const next = sorted[(currentIndex + 1) % sorted.length];
  if (next) windowManager.focus(next.id);
}

/** Bind global shell keyboard shortcuts (window cycle). */
export function initOsShellKeyboard(): void {
  if (shellKeyboardBound) return;
  shellKeyboardBound = true;

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey && event.code === 'Backquote') {
      event.preventDefault();
      cycleOsWindowsForward();
    }
  });
}
