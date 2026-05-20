/**
 * File panel UI state and persistence via config.json `filePanel` (Step 02 meta API).
 */

import { detectConfigServer } from '../config/storage-mode';

/** Persisted + in-memory file explorer / viewer preferences. */
export interface FilePanelState {
  fileSidebarCollapsed: boolean;
  viewerOpen: boolean;
  splitRatio: number;
  expandedDirs: string[];
  selectedPath: string | null;
  treeRoot: string;
}

export const DEFAULT_FILE_PANEL_STATE: FilePanelState = {
  fileSidebarCollapsed: false,
  viewerOpen: false,
  splitRatio: 0.55,
  expandedDirs: [],
  selectedPath: null,
  treeRoot: '.',
};

const SPLIT_MIN = 0.35;
const SPLIT_MAX = 0.75;

let panelState: FilePanelState = { ...DEFAULT_FILE_PANEL_STATE };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 400;

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FILE_PANEL_STATE.splitRatio;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
}

function normalizeFilePanelBlock(raw: unknown): FilePanelState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_FILE_PANEL_STATE };
  }
  const row = raw as Record<string, unknown>;
  const expandedDirs = Array.isArray(row.expandedDirs)
    ? row.expandedDirs.filter((p): p is string => typeof p === 'string')
    : [];
  return {
    fileSidebarCollapsed: row.fileSidebarCollapsed === true,
    viewerOpen: row.viewerOpen === true,
    splitRatio: clampSplitRatio(
      typeof row.splitRatio === 'number' ? row.splitRatio : DEFAULT_FILE_PANEL_STATE.splitRatio,
    ),
    expandedDirs,
    selectedPath: typeof row.selectedPath === 'string' ? row.selectedPath : null,
    treeRoot: typeof row.treeRoot === 'string' && row.treeRoot.trim() ? row.treeRoot : '.',
  };
}

async function fetchFilePanelFromMeta(): Promise<FilePanelState> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) {
    return { ...DEFAULT_FILE_PANEL_STATE };
  }
  const meta = (await res.json()) as Record<string, unknown>;
  return normalizeFilePanelBlock(meta.filePanel);
}

/** Current file panel state (mutate via patch helpers). */
export function getFilePanelState(): FilePanelState {
  return panelState;
}

/** Replace in-memory state (e.g. after load). */
export function setFilePanelState(next: FilePanelState): void {
  panelState = {
    ...next,
    splitRatio: clampSplitRatio(next.splitRatio),
    expandedDirs: [...next.expandedDirs],
  };
}

/** Merge partial state and schedule persistence. */
export function patchFilePanelState(partial: Partial<FilePanelState>): FilePanelState {
  panelState = {
    ...panelState,
    ...partial,
    splitRatio:
      partial.splitRatio !== undefined
        ? clampSplitRatio(partial.splitRatio)
        : panelState.splitRatio,
    expandedDirs:
      partial.expandedDirs !== undefined
        ? [...partial.expandedDirs]
        : panelState.expandedDirs,
  };
  scheduleSaveFilePanelPrefs();
  return panelState;
}

function scheduleSaveFilePanelPrefs(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveFilePanelPrefs();
  }, SAVE_DEBOUNCE_MS);
}

/** Load prefs from ~/.minnow/config.json when config server is up. */
export async function loadFilePanelPrefs(): Promise<FilePanelState> {
  const serverUp = await detectConfigServer();
  if (serverUp) {
    panelState = await fetchFilePanelFromMeta();
  } else {
    panelState = { ...DEFAULT_FILE_PANEL_STATE };
  }
  return panelState;
}

/** Persist current state to meta API (no localStorage). */
export async function saveFilePanelPrefs(): Promise<void> {
  const serverUp = await detectConfigServer();
  if (!serverUp) return;

  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePanel: panelState }),
  });
}

/** Test helper: reset module state. */
export function resetFilePanelStateForTests(): void {
  panelState = { ...DEFAULT_FILE_PANEL_STATE };
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
