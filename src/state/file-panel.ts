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

/** Where DevTools attaches relative to the preview guest. */
export type PreviewDevToolsDock = 'bottom' | 'side' | 'popout';

/** Max workspace file tabs persisted and open at once in the viewer strip. */
export const MAX_OPEN_VIEWER_TABS = 20;

/** Max preview browser tabs (each Electron tab is a live Chromium renderer). */
export const MAX_PREVIEW_TABS = 6;

/** Max recent viewer files remembered per workspace (empty-state MRU). */
export const MAX_RECENT_VIEWER_FILES = 12;

/** Persisted preview tab row (source only; title/loading are runtime). */
export interface PersistedPreviewTab {
  id: string;
  source: PreviewSource | null;
}

/** One recently opened workspace file (path is workspace-relative). */
export interface RecentViewerFileEntry {
  path: string;
  openedAt: number;
}

/**
 * Recent viewer files for one workspace root key.
 * Key is an absolute workspace/listing root, or `__default__` when unset.
 */
export type RecentViewerFilesByWorkspace = Record<string, RecentViewerFileEntry[]>;

/** Persisted + in-memory file explorer / viewer preferences. */
export interface FilePanelState {
  fileSidebarCollapsed: boolean;
  /** Expanded file sidebar width in px (persisted). */
  fileSidebarWidth?: number;
  /** @deprecated Use rightPaneMode; kept in sync for older persisted configs. */
  viewerOpen: boolean;
  rightPaneMode: RightPaneMode;
  /** @deprecated Migrated into previewTabs; kept in sync with active tab source. */
  previewSource: PreviewSource | null;
  previewAutoReload: boolean;
  /** Docked DevTools position in the preview guest (Electron only). */
  previewDevToolsDock: PreviewDevToolsDock;
  splitRatio: number;
  expandedDirs: string[];
  selectedPath: string | null;
  /** Workspace-relative paths open in the file viewer (attachments excluded). */
  openViewerTabs: string[];
  /** Active viewer tab path; must be in openViewerTabs or null. */
  activeViewerTab: string | null;
  /** Open preview browser tabs (order preserved). */
  previewTabs: PersistedPreviewTab[];
  /** Active preview tab id; must be in previewTabs or null. */
  activePreviewTab: string | null;
  /**
   * Most-recently-opened workspace files for the viewer empty state,
   * keyed by absolute workspace / listing root.
   */
  recentViewerFilesByWorkspace: RecentViewerFilesByWorkspace;
  treeRoot: string;
}

export const DEFAULT_FILE_PANEL_STATE: FilePanelState = {
  fileSidebarCollapsed: false,
  viewerOpen: false,
  rightPaneMode: null,
  previewSource: null,
  previewAutoReload: true,
  previewDevToolsDock: 'bottom',
  splitRatio: 0.55,
  expandedDirs: [],
  selectedPath: null,
  openViewerTabs: [],
  activeViewerTab: null,
  previewTabs: [],
  activePreviewTab: null,
  recentViewerFilesByWorkspace: {},
  treeRoot: '.',
};

/** Persisted split ratio bounds (main column share when the right pane is open). */
export const SPLIT_RATIO_MIN = 0.35;
export const SPLIT_RATIO_MAX = 0.75;
/** Dragging the split left past this main-column ratio collapses chat for a full-width preview. */
export const SPLIT_DRAG_CHAT_COLLAPSE_THRESHOLD = 0.12;

const SPLIT_MIN = SPLIT_RATIO_MIN;
const SPLIT_MAX = SPLIT_RATIO_MAX;
const FILE_SIDEBAR_MIN_W = 220;
const FILE_SIDEBAR_MAX_W = 560;
const DEFAULT_FILE_SIDEBAR_W = 350;

function clampFileSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FILE_SIDEBAR_W;
  return Math.min(FILE_SIDEBAR_MAX_W, Math.max(FILE_SIDEBAR_MIN_W, Math.round(value)));
}

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

function normalizeRightPaneMode(
  raw: unknown,
  viewerOpen: boolean,
  previewSource: PreviewSource | null,
): RightPaneMode {
  if (raw === 'viewer' || raw === 'preview') return raw;
  // Older configs saved viewerOpen without rightPaneMode/previewSource after browser open.
  if (previewSource && viewerOpen) return 'preview';
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

function normalizePreviewTabs(raw: unknown, legacySource: PreviewSource | null): PersistedPreviewTab[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const rows: PersistedPreviewTab[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, source: normalizePreviewSource(row.source) });
      if (rows.length >= MAX_PREVIEW_TABS) break;
    }
    if (rows.length > 0) return rows;
  }
  if (legacySource) {
    return [{ id: 'legacy-preview-tab', source: legacySource }];
  }
  return [];
}

function normalizeActivePreviewTab(
  raw: unknown,
  tabs: PersistedPreviewTab[],
): string | null {
  if (typeof raw === 'string' && raw.trim()) {
    const id = raw.trim();
    if (tabs.some((t) => t.id === id)) return id;
  }
  return tabs.length > 0 ? tabs[tabs.length - 1]!.id : null;
}

/** Normalize persisted recent-viewer-files map (workspace root → MRU list). */
function normalizeRecentViewerFilesByWorkspace(raw: unknown): RecentViewerFilesByWorkspace {
  if (!raw || typeof raw !== 'object') return {};
  const out: RecentViewerFilesByWorkspace = {};
  for (const [workspaceKey, entries] of Object.entries(raw as Record<string, unknown>)) {
    const key = workspaceKey.trim();
    if (!key || !Array.isArray(entries)) continue;
    const seen = new Set<string>();
    const list: RecentViewerFileEntry[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.path !== 'string') continue;
      const path = row.path
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\.\//, '');
      if (!path || path.startsWith('.minnow/attachments/') || seen.has(path)) continue;
      const openedAt =
        typeof row.openedAt === 'number' && Number.isFinite(row.openedAt)
          ? row.openedAt
          : 0;
      seen.add(path);
      list.push({ path, openedAt });
      if (list.length >= MAX_RECENT_VIEWER_FILES) break;
    }
    if (list.length > 0) out[key] = list;
  }
  return out;
}

/** Deep-copy recent-files map so callers cannot mutate persisted state in place. */
function cloneRecentViewerFilesByWorkspace(
  map: RecentViewerFilesByWorkspace,
): RecentViewerFilesByWorkspace {
  const out: RecentViewerFilesByWorkspace = {};
  for (const [key, entries] of Object.entries(map)) {
    out[key] = entries.map((e) => ({ path: e.path, openedAt: e.openedAt }));
  }
  return out;
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
  const previewSource = normalizePreviewSource(row.previewSource);
  const rightPaneMode = normalizeRightPaneMode(row.rightPaneMode, viewerOpenLegacy, previewSource);
  const viewerOpen = rightPaneMode !== null;
  const selectedPath = typeof row.selectedPath === 'string' ? row.selectedPath : null;
  const openViewerTabs = normalizeViewerTabPaths(row.openViewerTabs);
  const legacySelected =
    selectedPath &&
    !selectedPath.startsWith('.minnow/attachments/') &&
    openViewerTabs.length === 0 &&
    rightPaneMode !== 'preview'
      ? [selectedPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '')]
      : openViewerTabs;
  const tabs =
    legacySelected.length > openViewerTabs.length ? legacySelected.slice(0, MAX_OPEN_VIEWER_TABS) : openViewerTabs;
  const activeViewerTab = normalizeActiveViewerTab(
    row.activeViewerTab,
    tabs,
    rightPaneMode === 'preview' ? null : selectedPath,
  );
  const previewTabs = normalizePreviewTabs(row.previewTabs, previewSource);
  const activePreviewTab = normalizeActivePreviewTab(row.activePreviewTab, previewTabs);
  const syncedPreviewSource =
    activePreviewTab
      ? (previewTabs.find((t) => t.id === activePreviewTab)?.source ?? previewSource)
      : previewSource;
  const syncedSelected = activeViewerTab ?? selectedPath;
  return {
    fileSidebarCollapsed: row.fileSidebarCollapsed === true,
    fileSidebarWidth:
      typeof row.fileSidebarWidth === 'number'
        ? clampFileSidebarWidth(row.fileSidebarWidth)
        : undefined,
    viewerOpen,
    rightPaneMode,
    previewSource: syncedPreviewSource,
    previewAutoReload: row.previewAutoReload !== false,
    previewDevToolsDock:
      row.previewDevToolsDock === 'side'
        ? 'side'
        : row.previewDevToolsDock === 'popout'
          ? 'popout'
          : 'bottom',
    splitRatio: clampSplitRatio(
      typeof row.splitRatio === 'number' ? row.splitRatio : DEFAULT_FILE_PANEL_STATE.splitRatio,
    ),
    expandedDirs,
    selectedPath: syncedSelected,
    openViewerTabs: tabs,
    activeViewerTab,
    previewTabs,
    activePreviewTab,
    recentViewerFilesByWorkspace: normalizeRecentViewerFilesByWorkspace(
      row.recentViewerFilesByWorkspace,
    ),
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
    fileSidebarWidth:
      next.fileSidebarWidth !== undefined
        ? clampFileSidebarWidth(next.fileSidebarWidth)
        : next.fileSidebarWidth,
    expandedDirs: [...next.expandedDirs],
    openViewerTabs: [...next.openViewerTabs],
    previewTabs: [...next.previewTabs],
    recentViewerFilesByWorkspace: cloneRecentViewerFilesByWorkspace(
      next.recentViewerFilesByWorkspace ?? {},
    ),
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
    fileSidebarWidth:
      partial.fileSidebarWidth !== undefined
        ? clampFileSidebarWidth(partial.fileSidebarWidth)
        : panelState.fileSidebarWidth,
    expandedDirs:
      partial.expandedDirs !== undefined
        ? [...partial.expandedDirs]
        : panelState.expandedDirs,
    openViewerTabs:
      partial.openViewerTabs !== undefined
        ? [...partial.openViewerTabs]
        : panelState.openViewerTabs,
    previewTabs:
      partial.previewTabs !== undefined ? [...partial.previewTabs] : panelState.previewTabs,
    recentViewerFilesByWorkspace:
      partial.recentViewerFilesByWorkspace !== undefined
        ? cloneRecentViewerFilesByWorkspace(partial.recentViewerFilesByWorkspace)
        : cloneRecentViewerFilesByWorkspace(panelState.recentViewerFilesByWorkspace),
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

/** Test helper: parse a raw filePanel block like the meta API. */
export function normalizeFilePanelBlockForTests(raw: unknown): FilePanelState {
  return normalizeFilePanelBlock(raw);
}
