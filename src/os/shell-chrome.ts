import { getForegroundAppId, getOsView } from './instances';
import { windowManager } from './window-manager';

/** True when the focused floating window fills the stage. */
export function isFocusedWindowMaximized(): boolean {
  const focusedId = windowManager.getFocusedWindowId();
  if (!focusedId) return false;
  const win = windowManager.getWindows().find((w) => w.id === focusedId);
  return Boolean(win && win.maximized && !win.minimized);
}

/**
 * True when the dock and desktop chat rail should be hidden
 * (fullscreen presentation apps or a maximized window).
 */
export function shouldSuppressDesktopChrome(): boolean {
  if (getOsView() === 'app' && getForegroundAppId()) return true;
  return isFocusedWindowMaximized();
}
