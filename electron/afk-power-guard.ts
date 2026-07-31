/**
 * Prevent macOS App Nap / display sleep from suspending the renderer while AFK boards run.
 */

import { powerSaveBlocker } from 'electron';

let blockerId: number | null = null;

/** Enable or disable the OS power-save block while any AFK/auto board is running. */
export function setAfkBoardPowerGuardActive(active: boolean): void {
  if (active) {
    if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
    return;
  }
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
  blockerId = null;
}

/** Test helper — reset and stop any active blocker. */
export function resetAfkBoardPowerGuardForTests(): void {
  setAfkBoardPowerGuardActive(false);
}
