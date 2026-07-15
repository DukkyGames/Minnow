/**
 * Reparent shared file-tree / preview / viewer DOM between Code and desktop drawer.
 */

import { getDesktopWorkspacePath } from '../lib/desktop-workspace';
import { getFilePanelState } from '../state/file-panel';
import { getWorkspacePath } from '../state/workspace';
import { isDesktopChatActive } from './desktop-state';
import { getForegroundAppId, getOsView } from './instances';
import {
  collapseDesktopWorkspacePanel,
  getDesktopWorkspacePanelState,
  getDesktopWorkspaceTab,
  isDesktopWorkspacePanelOpen,
  openDesktopWorkspaceTab,
  subscribeDesktopWorkspacePanel,
  type DesktopWorkspaceTab,
} from './desktop-workspace-state';
import {
  fileTreeListingRootsEqual,
  getFileTreeListingWorkspaceRoot,
  setFileTreeListingWorkspaceRoot,
} from '../ui/file-tree-listing-root';
import { repairRightPaneDomStructure } from '../ui/file-layout';

type MountSurface = 'code' | 'desktop' | null;

interface ReparentRecord {
  node: HTMLElement;
  codeParent: HTMLElement;
  codeNextSibling: ChildNode | null;
  desktopHostId: string;
  nodeId: string;
}

const REPARENT_TARGETS: Array<{
  nodeId: string;
  codeParentId: string;
  desktopHostId: string;
}> = [
  {
    nodeId: 'fileSidebarFilesView',
    codeParentId: 'fileSidebar',
    desktopHostId: 'desktopFileTreeMount',
  },
  {
    nodeId: 'previewPane',
    codeParentId: 'rightPaneColumn',
    desktopHostId: 'desktopPreviewMount',
  },
  {
    nodeId: 'fileViewerPane',
    codeParentId: 'rightPaneColumn',
    desktopHostId: 'desktopFileViewerMount',
  },
];

let mountSurface: MountSurface = null;
let records: ReparentRecord[] = [];
let panelSubscribed = false;
let resizeObserver: ResizeObserver | null = null;
/** Bumps on each sync so overlapping async runs do not apply a stale surface. */
let syncGeneration = 0;

function isCodeForeground(): boolean {
  return getOsView() === 'app' && getForegroundAppId() === 'code';
}

function shouldHostOnDesktop(): boolean {
  if (isCodeForeground()) return false;
  return isDesktopChatActive() || getOsView() === 'desktop';
}

/** True when file-tree / preview / viewer mounts are hosted in the desktop drawer. */
export function isDesktopWorkspaceHostingActive(): boolean {
  return shouldHostOnDesktop();
}

function captureRecords(): void {
  if (records.length) return;
  for (const target of REPARENT_TARGETS) {
    const node = document.getElementById(target.nodeId);
    const codeParent = document.getElementById(target.codeParentId);
    if (!node || !codeParent) continue;
    records.push({
      node,
      codeParent,
      codeNextSibling: node.nextSibling,
      desktopHostId: target.desktopHostId,
      nodeId: target.nodeId,
    });
  }
}

function mountToDesktop(hostId: string, node: HTMLElement): void {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.replaceChildren();
  host.appendChild(node);
  // Drawer hosts always show the mounted node; Code visibility is restored on the way back.
  node.classList.remove('hidden');
}

/**
 * Whether a pane should carry `.hidden` after returning to the Code layout.
 * Do not reuse the class captured while the node was desktop-mounted (drawer always
 * strips `.hidden`) — that left the browser open on Code entry (MIN-342 regression).
 */
function shouldHidePaneInCode(nodeId: string): boolean {
  if (nodeId === 'fileSidebarFilesView') return false;
  const mode = getFilePanelState().rightPaneMode;
  if (nodeId === 'previewPane') return mode !== 'preview';
  if (nodeId === 'fileViewerPane') return mode !== 'viewer';
  return false;
}

function restoreToCode(record: ReparentRecord): void {
  const { node, codeParent, codeNextSibling, nodeId } = record;
  if (codeNextSibling && codeNextSibling.parentNode === codeParent) {
    codeParent.insertBefore(node, codeNextSibling);
  } else {
    codeParent.appendChild(node);
  }
  node.classList.toggle('hidden', shouldHidePaneInCode(nodeId));
}

/** Point the file tree at the desktop sandbox or Code workspace; true when root changed. */
async function applyListingRootForSurface(surface: MountSurface): Promise<boolean> {
  const prev = getFileTreeListingWorkspaceRoot();
  if (surface === 'desktop') {
    const desktopPath = await getDesktopWorkspacePath();
    setFileTreeListingWorkspaceRoot(desktopPath ?? undefined);
  } else {
    const main = getWorkspacePath().trim();
    setFileTreeListingWorkspaceRoot(main || undefined);
  }
  return !fileTreeListingRootsEqual(prev, getFileTreeListingWorkspaceRoot());
}

function syncDrawerPaneVisibility(): void {
  const state = getDesktopWorkspacePanelState();
  const filesHost = document.getElementById('desktopFileTreeMount');
  const previewHost = document.getElementById('desktopPreviewMount');
  const viewerHost = document.getElementById('desktopFileViewerMount');

  const show = state.open && mountSurface === 'desktop';
  filesHost?.classList.toggle('is-active', show && state.tab === 'files');
  previewHost?.classList.toggle('is-active', show && state.tab === 'browser');
  viewerHost?.classList.toggle('is-active', show && state.tab === 'viewer');

  const rail = document.querySelector('.mn-os-workspace-rail');
  rail?.classList.toggle('is-expanded', show);
  rail?.classList.toggle('is-collapsed', !show);

  for (const tabId of ['btnDesktopWorkspaceFiles', 'btnDesktopWorkspaceBrowser', 'btnDesktopWorkspaceViewer']) {
    const btn = document.getElementById(tabId);
    if (!btn) continue;
    const tab = btn.dataset.workspaceTab as DesktopWorkspaceTab | undefined;
    btn.setAttribute('aria-expanded', show && tab === state.tab ? 'true' : 'false');
  }
}

async function refreshFileTreeForSurface(): Promise<void> {
  const panel = getDesktopWorkspacePanelState();
  if (mountSurface === 'desktop' && (!panel.open || panel.tab !== 'files')) {
    return;
  }
  if (!document.getElementById('fileTreeHost')) {
    return;
  }
  const { ensureCodeWorkspaceModules } = await import('../boot/code-workspace-modules');
  await ensureCodeWorkspaceModules();
  const { initFileTreeIfNeeded, refreshFileTree } = await import('../ui/file-tree');
  await initFileTreeIfNeeded();
  await refreshFileTree();
}

function bindResizeObserver(): void {
  if (resizeObserver || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    void import('../ui/preview-electron-visibility').then((m) =>
      m.scheduleElectronPreviewHostLayoutSync(),
    );
  });
  const previewBody = document.getElementById('previewBody');
  if (previewBody) resizeObserver.observe(previewBody);
  const drawer = document.querySelector('.mn-os-workspace-rail-drawer');
  if (drawer) resizeObserver.observe(drawer);
}

/** Apply Code/desktop reparent when the target surface still matches after awaits. */
async function applySurfaceChange(
  nextSurface: MountSurface,
  generation: number,
): Promise<boolean> {
  if (generation !== syncGeneration) return false;
  // Re-resolve after awaits — a stale desktop sync must not win over Code foreground.
  const liveSurface: MountSurface = shouldHostOnDesktop() ? 'desktop' : 'code';
  if (liveSurface !== nextSurface) return false;

  if (nextSurface === 'desktop') {
    for (const record of records) {
      mountToDesktop(record.desktopHostId, record.node);
    }
    mountSurface = 'desktop';
    return true;
  }

  for (const record of records) {
    restoreToCode(record);
  }
  mountSurface = 'code';
  if (!document.getElementById('btnFileSidebarCollapse')) return true;

  if (isCodeForeground()) {
    // Code entry always starts with both right panes closed (MIN-342).
    const preview = await import('../ui/preview-panel');
    if (generation !== syncGeneration) return false;
    preview.collapsePreviewPanelKeepingSource();
  } else {
    const fileLayout = await import('../ui/file-layout');
    if (generation !== syncGeneration) return false;
    fileLayout.reconcileRightSplitDomWithState();
    fileLayout.applyFileSidebarVisuals();
  }
  return true;
}

/** Move shared mounts to desktop drawer hosts or restore to Code layout. */
export async function syncDesktopWorkspaceMounts(): Promise<void> {
  const generation = ++syncGeneration;

  if (repairRightPaneDomStructure()) {
    records = [];
  }
  captureRecords();
  const nextSurface: MountSurface = shouldHostOnDesktop() ? 'desktop' : 'code';
  const surfaceChanged = nextSurface !== mountSurface;
  const listingRootChanged = await applyListingRootForSurface(nextSurface);
  if (generation !== syncGeneration) return;

  if (surfaceChanged) {
    const applied = await applySurfaceChange(nextSurface, generation);
    if (!applied || generation !== syncGeneration) return;
  }

  if (surfaceChanged || listingRootChanged) {
    await refreshFileTreeForSurface();
    if (generation !== syncGeneration) return;
  }

  // If Code is foreground, never leave drawer hosts marked active (stale Electron overlay).
  if (isCodeForeground() && mountSurface !== 'code') {
    const applied = await applySurfaceChange('code', generation);
    if (!applied || generation !== syncGeneration) return;
  }

  syncDrawerPaneVisibility();
  const previewPanel = await import('../ui/preview-panel');
  if (generation !== syncGeneration) return;
  await previewPanel.syncPreviewDesignToolbarForSurface();
  if (generation !== syncGeneration) return;
  if (typeof window !== 'undefined' && window.minnow?.preview) {
    bindResizeObserver();
    const previewVisibility = await import('../ui/preview-electron-visibility');
    if (generation !== syncGeneration) return;
    await previewVisibility.syncElectronPreviewHostLayout();
  }
}

/** Open the browser drawer and show preview chrome (agent navigation). */
export async function revealDesktopBrowserPanel(): Promise<void> {
  openDesktopWorkspaceTab('browser');
  const { showPreviewSplit } = await import('../ui/file-layout');
  showPreviewSplit();
  await syncDesktopWorkspaceMounts();
}

/** Open the file viewer drawer for a workspace-relative path. */
export async function openDesktopWorkspaceFile(relativePath: string): Promise<void> {
  openDesktopWorkspaceTab('viewer');
  const { showViewerSplit } = await import('../ui/file-layout');
  showViewerSplit();
  await syncDesktopWorkspaceMounts();
  const { openFileInViewer } = await import('../ui/file-viewer');
  await openFileInViewer(relativePath);
}

/** True when the browser tab is open on desktop with preview visible. */
export function isDesktopBrowserSurfaceActive(): boolean {
  return (
    mountSurface === 'desktop' &&
    isDesktopWorkspacePanelOpen() &&
    getDesktopWorkspaceTab() === 'browser'
  );
}

/** Wire panel state → mount visibility (call once from desktop render). */
export function initDesktopWorkspaceMountBridge(): void {
  if (panelSubscribed) return;
  panelSubscribed = true;
  subscribeDesktopWorkspacePanel(() => {
    void syncDesktopWorkspaceMounts();
    if (isDesktopWorkspacePanelOpen()) {
      void import('../ui/desktop-chat-rail').then((m) => m.collapseDesktopChatRail());
    }
  });
}

/** Reset module state (tests). */
export function resetDesktopWorkspaceMountsForTests(): void {
  mountSurface = null;
  records = [];
  panelSubscribed = false;
  syncGeneration = 0;
  resizeObserver?.disconnect();
  resizeObserver = null;
}

export { collapseDesktopWorkspacePanel, openDesktopWorkspaceTab };
