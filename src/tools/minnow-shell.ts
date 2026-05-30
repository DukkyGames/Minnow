/**
 * Detect whether the renderer runs inside the Minnow Electron desktop shell.
 * Browser automation tools are catalog-visible only in that environment.
 */

/** True when electron/preload.ts exposed the Minnow bridge (desktop app window). */
export function isMinnowElectronShell(): boolean {
  return typeof window !== 'undefined' && window.minnow?.app?.isElectron === true;
}

/**
 * Whether built-in browser_* tools may be offered to the model in this window.
 * Uses the shell flag — not individual IPC methods (those are checked at execution).
 */
export function isElectronPreviewAvailable(): boolean {
  return isMinnowElectronShell();
}

/** True when preview automation IPC (execJs, navigate, screenshot) is wired. */
export function isPreviewAutomationReady(): boolean {
  if (!isMinnowElectronShell()) return false;
  const preview = window.minnow?.preview;
  if (!preview) return false;
  return (
    typeof preview.execJs === 'function' &&
    typeof preview.navigateAndWait === 'function' &&
    typeof preview.capturePage === 'function'
  );
}
