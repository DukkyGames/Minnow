/**
 * Launch-at-login helpers — OS state is authoritative (not duplicated in config.json).
 */

import { app } from 'electron';

export interface LoginItemSnapshot {
  openAtLogin: boolean;
  supported: boolean;
}

/** Normalize Electron login-item settings across platforms. */
export function readLoginItemSnapshot(): LoginItemSnapshot {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { openAtLogin: false, supported: false };
  }
  try {
    const settings = app.getLoginItemSettings();
    return { openAtLogin: Boolean(settings.openAtLogin), supported: true };
  } catch {
    return { openAtLogin: false, supported: false };
  }
}

/** Enable or disable launch at login for the packaged app. */
export function writeLoginItemOpenAtLogin(enabled: boolean): LoginItemSnapshot {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { openAtLogin: false, supported: false };
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false,
  });
  return readLoginItemSnapshot();
}
