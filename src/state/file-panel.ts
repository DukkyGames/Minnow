/**
 * File panel UI state and persistence via config.json `filePanel` (Step 02 meta API).
 */

import { detectConfigServer } from '../config/storage-mode';

/** Workspace file or arbitrary URL shown in the preview panel. */
export type PreviewSource =
  | { kind: 'workspace'; path: string }
  | { kind: 'url'; url: string };

/** Which pane occupies the right split (null = closed). */
export type RightPaneMode = 'viewer' | 'preview' | null;

/** Max workspace file tabs persisted and open at once in the viewer strip. */
export const MAX_OPEN_VIEWER_TABS = 20;

/** Persisted + in-memory file explorer / viewer preferences. */
export interface FilePanelState {
  fileSidebarCollapsed: boolean;
  /** @deprecated Use rightPaneMode; kept in sync for older persisted configs. */
  viewerOpen: boolean;
  rightPaneMode: RightPaneMode;
  previewSource: PreviewSource | null;
  previewAutoReload: boolean;
  splitRatio: number;
  expandedDirs: string[];
  selectedPath: string | null;
  /** Workspace-relative paths open in the file viewer (attachments excluded). */
  openViewerTabs: string[];
  /** Active viewer tab path; must be in openViewerTabs or null. */
  activeViewerTab: string | null;
  treeRoot: string;
}

export const DEFAULT_FILE_PANEL_STATE: FilePanelState = {
  fileSidebarCollapsed: false,
  viewerOpen: false,
  rightPaneMode: null,
  previewSource: null,
  previewAutoReload: true,
  splitRatio: 0.55,
  expandedDirs: [],
  selectedPath: null,
  openViewerTabs: [],
  activeViewerTab: null,
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

function normalizePreviewSource(raw: unknown): PreviewSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.kind === 'workspace' && typeof row.path === 'string' && row.path.trim()) {
    return { kind: 'workspace', path: row.path };
  }
  if (row.kind === 'url' && typeof row.url === 'string' && row.url.trim()) {
    return { kind: 'url', url: row.url };
  }
  return null;
}

function normalizeRightPaneMode(raw: unknown, viewerOpen: boolean): RightPaneMode {
  if (raw === 'viewer' || raw === 'preview') return raw;
  if (viewerOpen) return 'viewer';
  return null;
}

function normalizeViewerTabPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.startsWith('.minnow/attachments/')) continue;
    const norm = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    paths.push(norm);
    if (paths.length >= MAX_OPEN_VIEWER_TABS) break;
  }
  return paths;
}

function normalizeActiveViewerTab(
  raw: unknown,
  openTabs: string[],
  selectedPath: string | null,
): string | null {
  if (typeof raw === 'string' && raw.trim()) {
    const norm = raw.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
    if (openTabs.includes(norm)) return norm;
  }
  if (selectedPath) {
    const sel = selectedPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
    if (openTabs.includes(sel)) return sel;
  }
  return openTabs.length > 0 ? openTabs[openTabs.length - 1]! : null;
}

function normalizeFilePanelBlock(raw: unknown): FilePanelState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_FILE_PANEL_STATE };
  }
  const row = raw as Record<string, unknown>;
  const expandedDirs = Array.isArray(row.expandedDirs)
    ? row.expandedDirs.filter((p): p is string => typeof p === 'string')
    : [];
  const viewerOpenLegacy = row.viewerOpen === true;
  const rightPaneMode = normalizeRightPaneMode(row.rightPaneMode, viewerOpenLegacy);
  const viewerOpen = rightPaneMode !== null;
  const selectedPath = typeof row.selectedPath === 'string' ? row.selectedPath : null;
  const openViewerTabs = normalizeViewerTabPaths(row.openViewerTabs);
  const legacySelected =
    selectedPath &&
    !selectedPath.startsWith('.minnow/attachments/') &&
    openViewerTabs.length === 0
      ? [selectedPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '')]
      : openViewerTabs;
  const tabs =
    legacySelected.length > openViewerTabs.length ? legacySelected.slice(0, MAX_OPEN_VIEWER_TABS) : openViewerTabs;
  const activeViewerTab = normalizeActiveViewerTab(
    row.activeViewerTab,
    tabs,
    selectedPath,
  );
  const syncedSelected = activeViewerTab ?? selectedPath;
  return {
    fileSidebarCollapsed: row.fileSidebarCollapsed === true,
    viewerOpen,
    rightPaneMode,
    previewSource: normalizePreviewSource(row.previewSource),
    previewAutoReload: row.previewAutoReload !== false,
    splitRatio: clampSplitRatio(
      typeof row.splitRatio === 'number' ? row.splitRatio : DEFAULT_FILE_PANEL_STATE.splitRatio,
    ),
    expandedDirs,
    selectedPath: syncedSelected,
    openViewerTabs: tabs,
    activeViewerTab,
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
  const rightPaneMode = next.rightPaneMode ?? (next.viewerOpen ? 'viewer' : null);
  panelState = {
    ...next,
    rightPaneMode,
    viewerOpen: rightPaneMode !== null,
    splitRatio: clampSplitRatio(next.splitRatio),
    expandedDirs: [...next.expandedDirs],
    openViewerTabs: [...next.openViewerTabs],
  };
}

/** Merge partial state and schedule persistence. */
export function patchFilePanelState(partial: Partial<FilePanelState>): FilePanelState {
  const merged = {
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
    openViewerTabs:
      partial.openViewerTabs !== undefined
        ? [...partial.openViewerTabs]
        : panelState.openViewerTabs,
  };
  const rightPaneMode =
    partial.rightPaneMode !== undefined
      ? partial.rightPaneMode
      : partial.viewerOpen === true
        ? merged.rightPaneMode === 'preview'
          ? 'preview'
          : 'viewer'
        : partial.viewerOpen === false
          ? null
          : merged.rightPaneMode;
  panelState = {
    ...merged,
    rightPaneMode,
    viewerOpen: rightPaneMode !== null,
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
