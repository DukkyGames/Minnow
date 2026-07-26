/**
 * Launch-at-startup via Electron login item settings (authoritative; not duplicated in config.json).
 */

import { app } from 'electron';
import { normalizeLaunchAtStartup } from './login-item-normalize.js';

export { normalizeLaunchAtStartup } from './login-item-normalize.js';

/** Read whether Minnow is registered to open at OS login. */
export function readLaunchAtStartup(): boolean {
  return app.getLoginItemSettings().openAtLogin === true;
}

/** Register or remove the OS login item for this install. */
export function writeLaunchAtStartup(enabled: boolean): void {
  const openAtLogin = normalizeLaunchAtStartup(enabled);
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin, path: process.execPath });
    return;
  }
  app.setLoginItemSettings({ openAtLogin });
}
