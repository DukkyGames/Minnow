/**
 * Which folders currently have a shell window, shared by every surface that
 * offers to open one: the welcome/gate recents, the folder picker, and the
 * top-bar workspace menu.
 *
 * Only Electron can hold more than one view. In a browser every read comes back
 * empty and every action is a no-op, so callers can render the same markup
 * without branching on the shell.
 */

import { normalizeWorkspacePath } from './normalize-workspace-path';

export interface OpenWorkspaceWindow {
  windowId: number;
  workspacePath: string;
  /** False while the window is hidden in the system tray. */
  visible: boolean;
}

/** Open folders keyed by {@link normalizeWorkspacePath}, gate windows dropped. */
export type OpenWorkspaceMap = Map<string, OpenWorkspaceWindow>;

function toMap(windows: OpenWorkspaceWindow[]): OpenWorkspaceMap {
  const map: OpenWorkspaceMap = new Map();
  for (const win of windows) {
    const key = normalizeWorkspacePath(win.workspacePath);
    if (!key) continue;
    map.set(key, win);
  }
  return map;
}

/**
 * Read the open set. Falls back to the older `listWorkspaces` bridge so a
 * renderer running against a preload from a previous build still marks rows as
 * open — it just cannot tell backgrounded windows apart.
 */
export async function readOpenWorkspaceWindows(): Promise<OpenWorkspaceMap> {
  const api = window.minnow?.window;
  try {
    if (api?.listWorkspaceWindows) {
      return toMap(await api.listWorkspaceWindows());
    }
    if (api?.listWorkspaces) {
      const paths = await api.listWorkspaces();
      return toMap(
        paths.map((workspacePath) => ({ windowId: 0, workspacePath, visible: true })),
      );
    }
  } catch {
    // A shell mid-teardown answers nothing; an empty map is the safe reading.
  }
  return new Map();
}

/** Whether this shell can close another window's workspace at all. */
export function canCloseWorkspaceWindows(): boolean {
  return typeof window.minnow?.window?.closeWorkspace === 'function';
}

/**
 * Close the window holding a folder. Resolves to a human-readable error rather
 * than throwing, since every caller renders it into the status line.
 */
export async function closeOpenWorkspace(
  workspacePath: string,
): Promise<{ ok: true; closed: boolean } | { ok: false; error: string }> {
  const close = window.minnow?.window?.closeWorkspace;
  if (!close) return { ok: false, error: 'This build cannot close other windows' };
  try {
    return await close(workspacePath);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Subscribe to open/close/background changes. Returns a no-op outside Electron. */
export function onOpenWorkspacesChanged(
  callback: (windows: OpenWorkspaceMap) => void,
): () => void {
  const subscribe = window.minnow?.window?.onWorkspacesChanged;
  if (!subscribe) return () => {};
  return subscribe((windows) => callback(toMap(windows)));
}
