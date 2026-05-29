/**
 * Persist and restore main BrowserWindow bounds under Electron userData.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';

export interface PersistedWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

const DEFAULT_STATE: PersistedWindowState = {
  width: 1280,
  height: 800,
};

function getStateFilePath(): string {
  return path.join(app.getPath('userData'), 'minnow-window-state.json');
}

/** Load last saved bounds or defaults. */
export async function loadWindowState(): Promise<PersistedWindowState> {
  try {
    const raw = await fs.readFile(getStateFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedWindowState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      width: Number(parsed.width) || DEFAULT_STATE.width,
      height: Number(parsed.height) || DEFAULT_STATE.height,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Save bounds on resize/move/close. */
export function trackWindowState(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (win.isDestroyed()) return;
      const bounds = win.getBounds();
      const state: PersistedWindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized: win.isMaximized(),
      };
      try {
        await fs.writeFile(getStateFilePath(), JSON.stringify(state, null, 2), 'utf8');
      } catch (err) {
        console.warn('[electron] Failed to save window state:', err);
      }
    }, 200);
  };

  win.on('resize', persist);
  win.on('move', persist);
  win.on('close', persist);
}
