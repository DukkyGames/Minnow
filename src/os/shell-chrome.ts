import { getForegroundAppId, getOsView } from './instances';

/** Legacy hook — floating windows were removed in the workspace-first shell. */
export function isFocusedWindowMaximized(): boolean {
  return false;
}

/** Legacy hook — no window sheets after the window manager was removed. */
export function isPhoneWindowSheetOpen(): boolean {
  return false;
}

/** True when fullscreen app chrome should hide auxiliary shell affordances. */
export function shouldSuppressDesktopChrome(): boolean {
  return getOsView() === 'app' && Boolean(getForegroundAppId());
}
