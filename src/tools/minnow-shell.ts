/** True when electron/preload.ts exposed the Minnow bridge (desktop app window). */
export function isMinnowElectronShell(): boolean {
  return typeof window !== 'undefined' && window.minnow?.app?.isElectron === true;
}

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
