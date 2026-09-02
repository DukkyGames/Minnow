import { powerSaveBlocker } from 'electron';

let blockerId: number | null = null;

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

export function resetAfkBoardPowerGuardForTests(): void {
  setAfkBoardPowerGuardActive(false);
}
