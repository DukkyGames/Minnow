import { getForegroundAppId, getOsView } from './instances';
import { isPhoneLayout } from '../ui/mobile-layout';
import { windowManager } from './window-manager';

/** True when the focused floating window fills the stage. */
export function isFocusedWindowMaximized(): boolean {
  const focusedId = windowManager.getFocusedWindowId();
  if (!focusedId) return false;
  const win = windowManager.getWindows().find((w) => w.id === focusedId);
  return Boolean(win && win.maximized && !win.minimized);
}

/**
 * True when a phone window sheet covers the desktop.
 *
 * Windowed apps run inside the desktop view, so on a phone — where every window
 * is full-stage — the shell reports "on the desktop" while the desktop is
 * completely hidden. The menubar uses this to keep a way home on screen.
 */
export function isPhoneWindowSheetOpen(): boolean {
  return isPhoneLayout() && getOsView() === 'workspaces' && isFocusedWindowMaximized();
}

/**
 * True when the dock and desktop chat rail should be hidden
 * (fullscreen presentation apps or a maximized window).
 */
export function shouldSuppressDesktopChrome(): boolean {
  if (getOsView() === 'app' && getForegroundAppId()) return true;
  return isFocusedWindowMaximized();
}
