/**
 * Pause running orchestrate boards on real app quit (not display sleep or hide-to-tray).
 */

import { pauseAllRunningBoardsForShutdown } from '../../state/orchestrate-board-actions.ts';

let registered = false;

/** Test-only: allow re-registering shutdown hooks in isolated runs. */
export function resetOrchestrateBoardShutdownRegistrationForTests(): void {
  registered = false;
  if (typeof window !== 'undefined') {
    delete window.__minnowPauseBoardsForShutdown;
  }
}

/** System-pause boards so persisted autoRunning does not survive abrupt quit. */
function pauseBoardsForShutdown(): void {
  pauseAllRunningBoardsForShutdown();
}

declare global {
  interface Window {
    /** Invoked from Electron main via executeJavaScript during before-quit. */
    __minnowPauseBoardsForShutdown?: () => void;
  }
}

/** Register Electron shutdown hooks (not pagehide — sleep/lock must not pause boards). */
export function registerOrchestrateBoardShutdownHandler(): void {
  if (registered || typeof window === 'undefined') return;
  registered = true;

  window.__minnowPauseBoardsForShutdown = pauseBoardsForShutdown;

  try {
    window.minnow?.board?.onPauseForShutdown?.(() => {
      pauseBoardsForShutdown();
    });
  } catch {
    /* browser / tests */
  }
}
