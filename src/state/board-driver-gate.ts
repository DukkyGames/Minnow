/**
 * Who may run orchestrate board auto-drive (MIN-360 Phase 2).
 *
 * Tiny DOM-free gate so the Session Engine board host can claim drive without
 * importing session-sync (which pulls UI for remote reconcile).
 */

/** Injected engine-flag probe (renderer sets this; engine host ignores / uses owns flag). */
let engineFlagProbe: (() => boolean) | null = null;

/**
 * When true, this process is the Session Engine board host and may drive
 * regardless of the Phase 0 lease (flag-on path; lease unused for board guards).
 */
let engineOwnsBoardDrive = false;

/** Optional lease/storage probe injected by session-sync (renderer). */
let leaseDriveProbe: (() => boolean) | null = null;

/** Engine board host claims sole drive; clients leave this false. */
export function setEngineOwnsBoardDrive(owns: boolean): void {
  engineOwnsBoardDrive = owns;
}

/** Renderer wires Phase 0 lease / storage-mode probe once at sync init. */
export function setBoardDriverLeaseProbe(probe: (() => boolean) | null): void {
  leaseDriveProbe = probe;
}

/** Renderer wires the MINNOW_SERVER_ENGINE flag read (avoids importing UI-adjacent flag module in Node). */
export function setServerEngineFlagProbe(probe: (() => boolean) | null): void {
  engineFlagProbe = probe;
}

/** True when this client/process may run board auto-drive / delegation. */
export function canDriveOrchestrateBoard(): boolean {
  // Session Engine owns the board scheduler — only the engine host drives.
  if (engineOwnsBoardDrive) return true;
  // Flag on in the renderer: never locally auto-drive (engine resumes on server boot).
  if (engineFlagProbe?.() === true) return false;
  if (leaseDriveProbe) return leaseDriveProbe();
  // No sync yet (localStorage / early boot): allow drive.
  return true;
}
