/**
 * Who may run orchestrate board auto-drive (MIN-360 / MIN-362 Phase 4).
 *
 * Tiny DOM-free gate so the Session Engine board host can claim drive without
 * importing session-sync (which pulls UI for remote reconcile).
 *
 * Phase 4: the Phase 0 driver lease is gone — the engine is the sole driver
 * when the flag is on (default). Opt-out (MINNOW_SERVER_ENGINE=0) restores
 * renderer drive for emergency single-device use.
 */

/** Injected engine-flag probe (renderer sets this; engine host ignores / uses owns flag). */
let engineFlagProbe: (() => boolean) | null = null;

/**
 * When true, this process is the Session Engine board host and may drive
 * regardless of the client flag (server boot path).
 */
let engineOwnsBoardDrive = false;

/** Engine board host claims sole drive; clients leave this false. */
export function setEngineOwnsBoardDrive(owns: boolean): void {
  engineOwnsBoardDrive = owns;
}

/** Renderer wires the MINNOW_SERVER_ENGINE flag read (avoids importing UI-adjacent flag module in Node). */
export function setServerEngineFlagProbe(probe: (() => boolean) | null): void {
  engineFlagProbe = probe;
}

/** True when this client/process may run board auto-drive / delegation. */
export function canDriveOrchestrateBoard(): boolean {
  // Session Engine owns the board scheduler — only the engine host drives.
  if (engineOwnsBoardDrive) return true;
  // Flag on (default) in the renderer: never locally auto-drive.
  if (engineFlagProbe?.() === true) return false;
  // Flag off / opt-out / early boot: allow renderer drive.
  return true;
}
