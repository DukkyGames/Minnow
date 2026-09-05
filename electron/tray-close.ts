/**
 * What a window's close button should do.
 *
 * Kept free of Electron imports so it can be unit-tested — the repo convention
 * for main-process logic (see `tray-icon.ts`, `window-state-schema.ts`).
 */

/** User preference for closing one of several open windows. */
export type WindowCloseAction = 'ask' | 'close' | 'background';

export const DEFAULT_WINDOW_CLOSE_ACTION: WindowCloseAction = 'ask';

export function normalizeWindowCloseAction(raw: unknown): WindowCloseAction {
  return raw === 'close' || raw === 'background' || raw === 'ask'
    ? raw
    : DEFAULT_WINDOW_CLOSE_ACTION;
}

export interface CloseToTrayDecisionInput {
  closeToTrayEnabled: boolean;
  explicitQuit: boolean;
  quitInProgress: boolean;
  /** Set when something already decided this window really is going away. */
  forceClose?: boolean;
}

export function shouldHideWindowOnClose(input: CloseToTrayDecisionInput): boolean {
  if (input.quitInProgress || input.explicitQuit || input.forceClose) return false;
  return input.closeToTrayEnabled;
}

export function shouldQuitOnWindowAllClosed(closeToTrayEnabled: boolean): boolean {
  return !closeToTrayEnabled;
}

/** What `decideWindowClose` resolved to. `prompt` means ask the user. */
export type WindowCloseOutcome = 'close' | 'background' | 'prompt';

export interface WindowCloseDecisionInput extends CloseToTrayDecisionInput {
  /** How many shell windows exist right now, this one included. */
  openWindowCount: number;
  preference: WindowCloseAction;
}

/**
 * Closing the *last* window is the close-to-tray feature and never asks —
 * hiding it is the only way to keep chats and agents running.
 *
 * Closing one of *several* windows is a different act: the workspace it holds
 * should usually go away, and silently backgrounding it is what let hidden
 * windows pile up until the next launch reopened every folder ever opened.
 */
export function decideWindowClose(input: WindowCloseDecisionInput): WindowCloseOutcome {
  if (!shouldHideWindowOnClose(input)) return 'close';
  if (input.openWindowCount <= 1) return 'background';
  if (input.preference === 'close') return 'close';
  if (input.preference === 'background') return 'background';
  return 'prompt';
}
