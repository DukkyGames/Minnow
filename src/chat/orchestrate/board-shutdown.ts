/**
 * Pause running orchestrate boards when the window closes without Stop.
 */

import { pauseAllRunningBoardsForShutdown } from '../../state/orchestrate-board-actions.ts';

let registered = false;

/** Register a one-time pagehide handler so autoRunning is not left true on abrupt exit. */
export function registerOrchestrateBoardShutdownHandler(): void {
  if (registered || typeof window === 'undefined') return;
  registered = true;
  window.addEventListener('pagehide', () => {
    pauseAllRunningBoardsForShutdown();
  });
}
