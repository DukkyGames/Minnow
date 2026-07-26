/**
 * Pure close-vs-hide vs quit decisions for the Electron shell (testable).
 */

export interface CloseBehaviorInput {
  /** User preference: hide to tray instead of destroying the window. */
  closeToTray: boolean;
  /** Tray Quit, updater install, or another explicit shutdown path. */
  explicitQuit: boolean;
}

/** True when a window close should hide instead of destroying the BrowserWindow. */
export function shouldHideMainWindowOnClose(input: CloseBehaviorInput): boolean {
  if (input.explicitQuit) return false;
  return input.closeToTray;
}

export interface WindowAllClosedInput {
  closeToTray: boolean;
  platform: NodeJS.Platform;
  explicitQuit: boolean;
}

/**
 * True when the app should keep running after all windows are gone (tray / macOS dock).
 * Windows/Linux quit when close-to-tray is off; macOS stays alive per platform convention.
 */
export function shouldKeepAppAliveWhenAllWindowsClosed(input: WindowAllClosedInput): boolean {
  if (input.explicitQuit) return false;
  if (input.platform === 'darwin') return true;
  return input.closeToTray;
}
