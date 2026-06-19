/**
 * In-memory tab model for the file viewer (workspace + ephemeral attachment tabs).
 */

import {
  MAX_OPEN_VIEWER_TABS,
  getFilePanelState,
  patchFilePanelState,
} from '../state/file-panel';
import { basename, isAncestorPath, normalizeTreePath } from './file-tree-path';

export type ViewerTabKind = 'workspace' | 'attachment';
export type ViewerViewMode = 'editor' | 'markdown-preview' | 'image';
export type ViewerLoadStatus = 'loading' | 'ready' | 'error';

export interface ViewerTabInitialSelection {
  line: number;
  character: number;
}

export interface ViewerTabInitialLineRange {
  startLine: number;
  endLine: number;
}

/** Per-tab state mirrored from the former file-viewer module globals. */
export interface ViewerTabState {
  path: string;
  displayName: string;
  kind: ViewerTabKind;
  originalContent: string;
  isDirty: boolean;
  readOnlyExcerpt: boolean;
  readOnlyBannerText: string | null;
  viewMode: ViewerViewMode;
  loadStatus: ViewerLoadStatus;
  loadError?: string;
  pendingInitialSelection?: ViewerTabInitialSelection | null;
  pendingInitialLineRange?: ViewerTabInitialLineRange | null;
  /** Editor buffer when the tab is inactive but was previously edited. */
  cachedEditorContent?: string;
}

export interface OpenViewerTabOptions {
  skipUnsavedGuard?: boolean;
  asCode?: boolean;
  initialSelection?: ViewerTabInitialSelection;
  initialLineRange?: ViewerTabInitialLineRange;
  kind?: ViewerTabKind;
  displayName?: string;
  /** Preloaded content (attachments / restore without IO). */
  content?: string;
  readOnlyExcerpt?: boolean;
  readOnlyBannerText?: string | null;
  viewMode?: ViewerViewMode;
}

type TabStoreListener = () => void;

const tabs = new Map<string, ViewerTabState>();
let tabOrder: string[] = [];
let activeTabPath: string | null = null;
const listeners = new Set<TabStoreListener>();

/** Virtual paths for chat attachment snapshots (not persisted). */
export function isAttachmentViewerPath(path: string): boolean {
  return path.startsWith('.minnow/attachments/');
}

function tabKey(path: string): string {
  return isAttachmentViewerPath(path) ? path : normalizeTreePath(path);
}

function emitChange(): void {
  for (const fn of listeners) {
    fn();
  }
}

/** Subscribe to tab list / active tab changes (UI refresh). */
export function onViewerTabStoreChange(listener: TabStoreListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listViewerTabs(): ViewerTabState[] {
  return tabOrder
    .map((p) => tabs.get(p))
    .filter((t): t is ViewerTabState => t !== undefined);
}

export function getViewerTab(path: string): ViewerTabState | undefined {
  return tabs.get(tabKey(path));
}

export function getActiveViewerTab(): ViewerTabState | null {
  if (!activeTabPath) return null;
  return tabs.get(activeTabPath) ?? null;
}

export function getActiveViewerTabPath(): string | null {
  return activeTabPath;
}

export function isAnyViewerTabDirty(): boolean {
  for (const tab of tabs.values()) {
    if (tab.isDirty) return true;
  }
  return false;
}

export function isViewerTabDirty(path: string): boolean {
  return tabs.get(tabKey(path))?.isDirty ?? false;
}

export function getOpenViewerTabPaths(): string[] {
  return [...tabOrder];
}

function workspaceTabCount(): number {
  return tabOrder.filter((p) => !isAttachmentViewerPath(p)).length;
}

function persistWorkspaceTabs(): void {
  const workspacePaths = tabOrder.filter((p) => !isAttachmentViewerPath(p));
  const active =
    activeTabPath && !isAttachmentViewerPath(activeTabPath) ? activeTabPath : null;
  const panel = getFilePanelState();
  const patch: Parameters<typeof patchFilePanelState>[0] = {
    openViewerTabs: workspacePaths,
    activeViewerTab: active,
    selectedPath: activeTabPath,
  };
  // Never stomp browser preview mode when editor tabs persist asynchronously.
  if (panel.rightPaneMode !== 'preview') {
    patch.rightPaneMode = tabOrder.length > 0 ? 'viewer' : undefined;
  }
  patchFilePanelState(patch);
}

function setActiveInternal(path: string | null): void {
  activeTabPath = path;
  if (!path) return;
  if (isAttachmentViewerPath(path)) {
    patchFilePanelState({ selectedPath: path });
    return;
  }
  patchFilePanelState({
    selectedPath: path,
    activeViewerTab: path,
  });
}

/** Snapshot editor buffer from the active tab before switching away. */
export function snapshotActiveTabEditorContent(content: string, dirty: boolean): void {
  const tab = getActiveViewerTab();
  if (!tab || tab.viewMode === 'image') return;
  tab.cachedEditorContent = content;
  if (dirty !== tab.isDirty) {
    tab.isDirty = dirty;
    emitChange();
  }
}

/** Snapshot editor buffer into a specific tab (by path key). */
export function snapshotViewerTabEditorContent(
  path: string,
  content: string,
  dirty: boolean,
): void {
  const tab = getViewerTab(path);
  if (!tab || tab.viewMode === 'image') return;
  tab.cachedEditorContent = content;
  if (dirty !== tab.isDirty) {
    tab.isDirty = dirty;
    emitChange();
  }
}

export function updateActiveTabFromEditor(content: string, dirty: boolean): void {
  const tab = getActiveViewerTab();
  if (!tab) return;
  tab.cachedEditorContent = content;
  if (dirty !== tab.isDirty) {
    tab.isDirty = dirty;
    emitChange();
  }
}

export function markActiveTabSaved(content: string): void {
  const tab = getActiveViewerTab();
  if (!tab) return;
  tab.originalContent = content;
  tab.cachedEditorContent = content;
  tab.isDirty = false;
  emitChange();
}

export function setActiveTabLoadState(
  status: ViewerLoadStatus,
  payload?: {
    content?: string;
    readOnlyExcerpt?: boolean;
    viewMode?: ViewerViewMode;
    error?: string;
  },
): void {
  const tab = getActiveViewerTab();
  if (!tab) return;
  tab.loadStatus = status;
  if (payload?.content !== undefined) {
    tab.originalContent = payload.content;
    tab.cachedEditorContent = payload.content;
    tab.isDirty = false;
  }
  if (payload?.readOnlyExcerpt !== undefined) {
    tab.readOnlyExcerpt = payload.readOnlyExcerpt;
  }
  if (payload?.viewMode !== undefined) {
    tab.viewMode = payload.viewMode;
  }
  if (payload?.error !== undefined) {
    tab.loadError = payload.error;
  }
  emitChange();
}

function shouldUseMarkdownPreview(path: string, asCode?: boolean): boolean {
  const lower = path.toLowerCase();
  return (lower.endsWith('.md') || lower.endsWith('.markdown')) && !asCode;
}

function createTabState(path: string, options?: OpenViewerTabOptions): ViewerTabState {
  const key = tabKey(path);
  const kind = options?.kind ?? (isAttachmentViewerPath(path) ? 'attachment' : 'workspace');
  const displayName = options?.displayName ?? basename(key);
  const hasContent = options?.content !== undefined;
  const viewMode =
    options?.viewMode ??
    (shouldUseMarkdownPreview(path, options?.asCode) ? 'markdown-preview' : 'editor');
  return {
    path: key,
    displayName,
    kind,
    originalContent: options?.content ?? '',
    cachedEditorContent: options?.content,
    isDirty: false,
    readOnlyExcerpt: options?.readOnlyExcerpt ?? false,
    readOnlyBannerText: options?.readOnlyBannerText ?? null,
    viewMode,
    loadStatus: hasContent ? 'ready' : 'loading',
    pendingInitialSelection: options?.initialSelection ?? null,
    pendingInitialLineRange: options?.initialLineRange ?? null,
  };
}

export interface OpenViewerTabResult {
  focusedExisting: boolean;
  tab: ViewerTabState;
}

/**
 * Open or focus a tab. Returns whether an existing tab was focused.
 * When `confirmUnsaved` returns false, open is aborted.
 */
export function openViewerTab(
  path: string,
  options?: OpenViewerTabOptions & {
    confirmUnsaved?: () => boolean;
    /** Snapshot outgoing editor before unsaved guard / tab switch. */
    beforeActivate?: () => void;
  },
): OpenViewerTabResult | null {
  const key = tabKey(path);
  const existing = tabs.get(key);
  if (existing) {
    if (activeTabPath && activeTabPath !== key) {
      options?.beforeActivate?.();
    }
    if (
      !options?.skipUnsavedGuard &&
      activeTabPath &&
      activeTabPath !== key &&
      options?.confirmUnsaved &&
      !options.confirmUnsaved()
    ) {
      return null;
    }
    if (options?.initialSelection) {
      existing.pendingInitialSelection = options.initialSelection;
    }
    if (options?.initialLineRange) {
      existing.pendingInitialLineRange = options.initialLineRange;
    }
    if (options?.asCode && existing.viewMode === 'markdown-preview') {
      existing.viewMode = 'editor';
    }
    setActiveInternal(key);
    emitChange();
    persistWorkspaceTabs();
    return { focusedExisting: true, tab: existing };
  }

  if (activeTabPath) {
    options?.beforeActivate?.();
  }
  if (
    !options?.skipUnsavedGuard &&
    activeTabPath &&
    options?.confirmUnsaved &&
    !options.confirmUnsaved()
  ) {
    return null;
  }

  if (!isAttachmentViewerPath(key) && workspaceTabCount() >= MAX_OPEN_VIEWER_TABS) {
    return null;
  }

  const tab = createTabState(path, options);
  tabs.set(key, tab);
  tabOrder.push(key);
  setActiveInternal(key);
  emitChange();
  persistWorkspaceTabs();
  return { focusedExisting: false, tab };
}

export function activateViewerTab(
  path: string,
  options?: {
    skipUnsavedGuard?: boolean;
    confirmUnsaved?: () => boolean;
    /** Snapshot outgoing editor before unsaved guard / tab switch. */
    beforeActivate?: () => void;
  },
): boolean {
  const key = tabKey(path);
  if (!tabs.has(key)) return false;
  if (activeTabPath && activeTabPath !== key) {
    options?.beforeActivate?.();
  }
  if (
    !options?.skipUnsavedGuard &&
    activeTabPath &&
    activeTabPath !== key &&
    options?.confirmUnsaved &&
    !options.confirmUnsaved()
  ) {
    return false;
  }
  setActiveInternal(key);
  emitChange();
  persistWorkspaceTabs();
  return true;
}

export function removeViewerTab(path: string): void {
  const key = tabKey(path);
  if (!tabs.has(key)) return;
  tabs.delete(key);
  tabOrder = tabOrder.filter((p) => p !== key);
  if (activeTabPath === key) {
    const next = tabOrder[tabOrder.length - 1] ?? null;
    activeTabPath = next;
  }
  emitChange();
  persistWorkspaceTabs();
}

export function clearAllViewerTabs(): void {
  tabs.clear();
  tabOrder = [];
  activeTabPath = null;
  emitChange();
  patchFilePanelState({
    openViewerTabs: [],
    activeViewerTab: null,
    selectedPath: null,
  });
}

/** Workspace tab paths for persistence (order preserved). */
export function serializeWorkspaceViewerTabs(): string[] {
  return tabOrder.filter((p) => !isAttachmentViewerPath(p));
}

/** Restore tab strip after load; content loads when each tab is activated. */
export function restoreWorkspaceViewerTabs(paths: string[], activePath: string | null): void {
  tabs.clear();
  tabOrder = [];
  for (const p of paths.slice(0, MAX_OPEN_VIEWER_TABS)) {
    const key = normalizeTreePath(p);
    if (isAttachmentViewerPath(key)) continue;
    const tab = createTabState(key);
    tabs.set(key, tab);
    tabOrder.push(key);
  }
  const activeKey = activePath ? tabKey(activePath) : null;
  activeTabPath =
    activeKey && tabs.has(activeKey)
      ? activeKey
      : tabOrder.length > 0
        ? tabOrder[tabOrder.length - 1]!
        : null;
  emitChange();
}

export function retargetViewerTab(oldPath: string, newPath: string): void {
  const oldKey = tabKey(oldPath);
  const newKey = tabKey(newPath);
  const tab = tabs.get(oldKey);
  if (!tab) return;
  tabs.delete(oldKey);
  tab.path = newKey;
  tab.displayName = basename(newKey);
  tabs.set(newKey, tab);
  tabOrder = tabOrder.map((p) => (p === oldKey ? newKey : p));
  if (activeTabPath === oldKey) {
    activeTabPath = newKey;
  }
  emitChange();
  persistWorkspaceTabs();
}

export function closeViewerTabsUnderAncestor(ancestorPath: string): void {
  const norm = normalizeTreePath(ancestorPath);
  const toClose = tabOrder.filter((p) => {
    const pn = normalizeTreePath(p);
    return pn === norm || isAncestorPath(norm, pn);
  });
  for (const p of toClose) {
    tabs.delete(p);
  }
  tabOrder = tabOrder.filter((p) => !toClose.includes(p));
  if (activeTabPath && toClose.includes(activeTabPath)) {
    activeTabPath = tabOrder[tabOrder.length - 1] ?? null;
  }
  emitChange();
  persistWorkspaceTabs();
}

export function remapViewerTabsUnderAncestor(oldAncestor: string, newAncestor: string): string[] {
  const oldNorm = normalizeTreePath(oldAncestor);
  const newNorm = normalizeTreePath(newAncestor);
  const remapped: string[] = [];
  const nextOrder: string[] = [];
  for (const p of tabOrder) {
    const pn = normalizeTreePath(p);
    if (pn === oldNorm || isAncestorPath(oldNorm, pn)) {
      const newPath = normalizeTreePath(newNorm + pn.slice(oldNorm.length));
      const tab = tabs.get(p);
      if (tab) {
        tabs.delete(p);
        tab.path = newPath;
        tab.displayName = basename(newPath);
        tabs.set(newPath, tab);
        remapped.push(newPath);
        nextOrder.push(newPath);
      }
    } else {
      nextOrder.push(p);
    }
  }
  tabOrder = nextOrder;
  if (activeTabPath) {
    const activeNorm = normalizeTreePath(activeTabPath);
    if (isAncestorPath(oldNorm, activeNorm) || activeNorm === oldNorm) {
      activeTabPath = normalizeTreePath(newNorm + activeNorm.slice(oldNorm.length));
    }
  }
  emitChange();
  persistWorkspaceTabs();
  return remapped;
}

/** Test helper: reset in-memory tab store. */
export function resetViewerTabStoreForTests(): void {
  tabs.clear();
  tabOrder = [];
  activeTabPath = null;
  listeners.clear();
}
