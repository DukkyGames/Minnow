/**
 * Pure close-vs-quit decisions for the system tray lifecycle.
 */

export interface CloseToTrayDecisionInput {
  closeToTrayEnabled: boolean;
  explicitQuit: boolean;
  quitInProgress: boolean;
}

/** True when the window close event should hide to tray instead of quitting. */
export function shouldHideWindowOnClose(input: CloseToTrayDecisionInput): boolean {
  if (input.quitInProgress || input.explicitQuit) return false;
  return input.closeToTrayEnabled;
}

/** True when closing the last window should terminate the app (non-macOS path). */
export function shouldQuitOnWindowAllClosed(closeToTrayEnabled: boolean): boolean {
  // When close-to-tray is on we hide instead of destroying, so this rarely fires.
  return !closeToTrayEnabled;
}
