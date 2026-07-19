/**
 * Restore Electron renderer focus after blocking JavaScript dialogs on Windows.
 *
 * Chromium can leave a frameless BrowserWindow visually active while its web
 * contents no longer receive normal input. Re-focusing both layers through the
 * main process prevents controls from requiring an outside click to recover.
 */

const installedWindows = new WeakSet<Window>();

function requestFocusRecovery(targetWindow: Window): void {
  const restoreFocus = targetWindow.minnow?.window?.restoreFocus;
  if (!restoreFocus) return;

  void restoreFocus().catch(() => {
    // Focus recovery is best-effort and must not mask the dialog result.
  });
}

/** Wrap native alert/confirm/prompt once for the Windows Electron shell. */
export function initNativeDialogFocusRecovery(targetWindow: Window = window): void {
  if (installedWindows.has(targetWindow)) return;
  if (targetWindow.minnow?.app.platform !== 'win32') return;
  if (!targetWindow.minnow.window?.restoreFocus) return;

  const nativeAlert = targetWindow.alert.bind(targetWindow);
  const nativeConfirm = targetWindow.confirm.bind(targetWindow);
  const nativePrompt = targetWindow.prompt.bind(targetWindow);

  targetWindow.alert = (message?: unknown): void => {
    try {
      nativeAlert(message);
    } finally {
      requestFocusRecovery(targetWindow);
    }
  };

  targetWindow.confirm = (message?: string): boolean => {
    try {
      return nativeConfirm(message);
    } finally {
      requestFocusRecovery(targetWindow);
    }
  };

  targetWindow.prompt = (message?: string, defaultValue?: string): string | null => {
    try {
      return nativePrompt(message, defaultValue);
    } finally {
      requestFocusRecovery(targetWindow);
    }
  };

  installedWindows.add(targetWindow);
}
