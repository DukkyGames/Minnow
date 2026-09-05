/**
 * Shape and migration for the persisted window set — no Electron imports, so it
 * can be unit-tested (the repo convention: pure logic in a module with a sibling
 * test).
 */

export interface PersistedWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
  /** Absolute workspace folder this window was on, or `''` for the gate. */
  workspacePath?: string;
}

/** v2 stores one entry per open window instead of a single blob. */
export interface PersistedWindowSet {
  version: 2;
  windows: PersistedWindowState[];
}

export const DEFAULT_WINDOW_STATE: PersistedWindowState = {
  width: 1280,
  height: 800,
};

function coerceWindowState(raw: unknown): PersistedWindowState {
  const parsed = (raw ?? {}) as Partial<PersistedWindowState>;
  return {
    ...DEFAULT_WINDOW_STATE,
    ...parsed,
    width: Number(parsed.width) || DEFAULT_WINDOW_STATE.width,
    height: Number(parsed.height) || DEFAULT_WINDOW_STATE.height,
    workspacePath:
      typeof parsed.workspacePath === 'string' ? parsed.workspacePath : '',
  };
}

/**
 * Read the persisted window set. A v1 file (one bare blob, no `version`) reads
 * as a single unnamed entry, so an upgrade keeps the user's window geometry.
 */
export function parseWindowSet(raw: unknown): PersistedWindowSet {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj.version === 2 && Array.isArray(obj.windows)) {
      const windows = obj.windows.map(coerceWindowState);
      return { version: 2, windows: windows.length ? windows : [{ ...DEFAULT_WINDOW_STATE }] };
    }
    // v1: the whole file was one window's bounds.
    return { version: 2, windows: [coerceWindowState(obj)] };
  }
  return { version: 2, windows: [{ ...DEFAULT_WINDOW_STATE }] };
}
