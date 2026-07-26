/**
 * Persist desktopShell.closeToTray in config.json (renderer).
 */

import { getTrayApi } from '../electron/tray-client';

export const DEFAULT_CLOSE_TO_TRAY = true;

/** Normalize closeToTray; invalid values default to true. */
export function normalizeCloseToTray(value: unknown): boolean {
  if (value === false) return false;
  if (value === true) return true;
  return DEFAULT_CLOSE_TO_TRAY;
}

/** Read closeToTray from config meta API. */
export async function loadCloseToTrayFromConfig(): Promise<boolean> {
  try {
    const res = await fetch('/api/config/meta', { cache: 'no-store' });
    if (!res.ok) return DEFAULT_CLOSE_TO_TRAY;
    const meta = (await res.json()) as { desktopShell?: { closeToTray?: unknown } };
    return normalizeCloseToTray(meta.desktopShell?.closeToTray);
  } catch {
    return DEFAULT_CLOSE_TO_TRAY;
  }
}

/** Persist closeToTray via PUT /api/config/meta and sync Electron tray state. */
export async function saveCloseToTray(enabled: boolean): Promise<boolean> {
  const closeToTray = normalizeCloseToTray(enabled);
  const res = await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ desktopShell: { closeToTray } }),
  });
  if (!res.ok) {
    throw new Error('Could not save desktop shell setting');
  }
  const tray = getTrayApi();
  if (tray) {
    await tray.setCloseToTray(closeToTray);
  }
  return closeToTray;
}
