/**
 * Pause running orchestrate boards on real app quit (not display sleep or hide-to-tray),
 * and stamp in-flight chats so the boot resume gate can still prompt after Quit Minnow
 * cancels generations (which would otherwise clear currentGenerationId).
 */

import { pauseAllRunningBoardsForShutdown } from '../../state/orchestrate-board-actions.ts';
import { markInterruptedChatsForShutdown } from '../resume-interrupted.ts';

let registered = false;

/** Test-only: allow re-registering shutdown hooks in isolated runs. */
export function resetOrchestrateBoardShutdownRegistrationForTests(): void {
  registered = false;
  if (typeof window !== 'undefined') {
    delete window.__minnowPauseBoardsForShutdown;
    delete window.__minnowPrepareForShutdown;
  }
}

/**
 * Full renderer prep before the main process tears down generations / the HTTP server.
 * Order matters: stamp chats + flush first, then pause boards.
 */
function prepareSessionForShutdown(): void {
  markInterruptedChatsForShutdown();
  pauseAllRunningBoardsForShutdown();
}

/** System-pause boards so persisted autoRunning does not survive abrupt quit. */
function pauseBoardsForShutdown(): void {
  pauseAllRunningBoardsForShutdown();
}

declare global {
  interface Window {
    /** Invoked from Electron main via executeJavaScript during before-quit. */
    __minnowPauseBoardsForShutdown?: () => void;
    /** Preferred shutdown hook: interrupted chats + board pause. */
    __minnowPrepareForShutdown?: () => void;
  }
}

/** Register Electron shutdown hooks (not pagehide — sleep/lock must not pause boards). */
export function registerOrchestrateBoardShutdownHandler(): void {
  if (registered || typeof window === 'undefined') return;
  registered = true;

  window.__minnowPrepareForShutdown = prepareSessionForShutdown;
  // Kept for older Electron shells that only call the board-only name.
  window.__minnowPauseBoardsForShutdown = prepareSessionForShutdown;

  try {
    window.minnow?.board?.onPauseForShutdown?.(() => {
      prepareSessionForShutdown();
    });
  } catch {
    /* browser / tests */
  }
}
