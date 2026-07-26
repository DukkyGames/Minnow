/**
 * Persisted one-time tray UX hints under ~/.minnow.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function trayHintsPath(): string {
  const home = process.env.MINNOW_HOME?.trim() || path.join(os.homedir(), '.minnow');
  return path.join(home, 'tray-hints.json');
}

/** Load whether the one-time close notification was already shown. */
export function readCloseNotificationShown(): boolean {
  try {
    const raw = fs.readFileSync(trayHintsPath(), 'utf8');
    const parsed = JSON.parse(raw) as { closeNotificationShown?: unknown };
    return parsed.closeNotificationShown === true;
  } catch {
    return false;
  }
}

/** Mark the one-time close notification as shown (persisted under ~/.minnow). */
export function markCloseNotificationShown(): void {
  try {
    const dir = path.dirname(trayHintsPath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      trayHintsPath(),
      `${JSON.stringify({ closeNotificationShown: true }, null, 2)}\n`,
      'utf8',
    );
  } catch (err) {
    console.warn('[electron] could not persist tray hint:', err);
  }
}
