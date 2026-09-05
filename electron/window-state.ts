import fs from 'node:fs/promises';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import {
  DEFAULT_WINDOW_STATE,
  parseWindowSet,
  type PersistedWindowSet,
  type PersistedWindowState,
} from './window-state-schema.js';

export {
  parseWindowSet,
  type PersistedWindowSet,
  type PersistedWindowState,
} from './window-state-schema.js';

function getStateFilePath(): string {
  return path.join(app.getPath('userData'), 'minnow-window-state.json');
}

export async function loadWindowSet(): Promise<PersistedWindowSet> {
  try {
    const raw = await fs.readFile(getStateFilePath(), 'utf8');
    return parseWindowSet(JSON.parse(raw));
  } catch {
    return { version: 2, windows: [{ ...DEFAULT_WINDOW_STATE }] };
  }
}

/** Bounds for the first window, for callers that only need a default size. */
export async function loadWindowState(): Promise<PersistedWindowState> {
  const set = await loadWindowSet();
  return set.windows[0] ?? { ...DEFAULT_WINDOW_STATE };
}

/**
 * All writes go through one serialized queue. N windows each debouncing at 200ms
 * would otherwise interleave read-modify-write on the same file and lose entries.
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

/** Live window bounds, keyed by `BrowserWindow.id`. */
const liveWindowState = new Map<number, PersistedWindowState>();

/**
 * During a quit every window closes, and a closing window normally drops itself
 * from the set so it does not reopen next boot. That is right for "the user
 * closed this window" and wrong for "the app is quitting" — the whole point of
 * the set is to restore it. Freeze removals once quitting starts.
 */
let quitting = false;

export function setWindowStateQuitting(value: boolean): void {
  quitting = value;
}

async function persistLiveWindows(): Promise<void> {
  const windows = [...liveWindowState.values()];
  const payload: PersistedWindowSet = {
    version: 2,
    windows: windows.length ? windows : [{ ...DEFAULT_WINDOW_STATE }],
  };
  try {
    await fs.writeFile(getStateFilePath(), JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('[electron] Failed to save window state:', err);
  }
}

/**
 * Record a window's bounds (and the folder it is on) into the persisted set.
 * `getWorkspacePath` is read at save time so an in-window folder switch lands in
 * the file without re-wiring anything.
 */
export function trackWindowState(
  win: BrowserWindow,
  getWorkspacePath: () => string = () => '',
): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (): void => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    liveWindowState.set(win.id, {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
      workspacePath: getWorkspacePath(),
    });
  };

  const persist = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      snapshot();
      void enqueueWrite(persistLiveWindows);
    }, 200);
  };

  snapshot();

  win.on('resize', persist);
  win.on('move', persist);
  win.on('close', () => {
    // Capture the final bounds before the window goes away, then drop it from
    // the set so a closed window does not reopen on next boot.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    snapshot();
    void enqueueWrite(persistLiveWindows);
  });
  win.on('closed', () => {
    if (quitting) return;
    liveWindowState.delete(win.id);
    void enqueueWrite(persistLiveWindows);
  });
}

/** Test hook — forget every tracked window. */
export function resetTrackedWindowStateForTests(): void {
  liveWindowState.clear();
  quitting = false;
}
