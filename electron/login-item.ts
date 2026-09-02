import { app } from 'electron';

export interface LoginItemSnapshot {
  openAtLogin: boolean;
  supported: boolean;
}

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
