/**
 * Focus return stack when floating OS windows open and close.
 */

let focusReturnTarget: HTMLElement | null = null;

function isInsideOsWindow(el: HTMLElement): boolean {
  return Boolean(el.closest('.mn-os-window'));
}

/** Remember focus before a floating window steals it from outside the stack. */
export function rememberFocusBeforeWindowActivate(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && !isInsideOsWindow(active)) {
    focusReturnTarget = active;
  }
}

/** Restore focus saved before window activation when no windows remain. */
export function restoreFocusAfterWindowsClosed(): void {
  const target = focusReturnTarget;
  focusReturnTarget = null;
  if (target?.isConnected) {
    target.focus();
    return;
  }
  const dock = document.querySelector<HTMLElement>('.mn-os-dock-tile[tabindex="0"]');
  dock?.focus();
}

/** Test reset. */
export function resetWindowFocusMemoryForTests(): void {
  focusReturnTarget = null;
}
