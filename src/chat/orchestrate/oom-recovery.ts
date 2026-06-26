/**
 * Renderer-side OOM recovery state after a render-process-gone OOM kill.
 * Main process persists ~/.minnow/logs/oom-pause.json; this module probes it at boot.
 */

/** Cap concurrent AFK tasks while OOM recovery is active (within 24h of last OOM). */
export const OOM_SAFE_MAX_CONCURRENT = 2;

let oomPauseActive = false;

/** Whether the current session should throttle board concurrency after an OOM crash. */
export function isOomPauseActive(): boolean {
  return oomPauseActive;
}

/** Set boot-time OOM pause flag (tests and boot resume). */
export function setOomPauseActiveForBoot(active: boolean): void {
  oomPauseActive = active;
}

/** Read OOM pause marker from Electron diagnostics IPC when available. */
export async function probeOomPauseFromElectron(): Promise<boolean> {
  try {
    const marker = (await window.minnow?.diagnostics?.getOomPause?.()) as
      | { reason?: string }
      | null
      | undefined;
    return marker?.reason === 'oom';
  } catch {
    return false;
  }
}

/** Clear OOM pause marker after the user explicitly starts the board again. */
export async function clearOomPauseFromElectron(): Promise<void> {
  try {
    await window.minnow?.diagnostics?.clearOomPause?.();
  } catch {
    /* best-effort */
  }
  setOomPauseActiveForBoot(false);
}
