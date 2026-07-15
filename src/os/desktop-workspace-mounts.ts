/**
 * Reparent shared file-tree / preview / viewer DOM between Code and desktop drawer.
 */

import { getDesktopWorkspacePath } from '../lib/desktop-workspace';
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
  /** Whether the node carried `.hidden` in the Code layout before any desktop mount. */
  codeHadHiddenClass: boolean;
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
      codeHadHiddenClass: node.classList.contains('hidden'),
    });
  }
}

function mountToDesktop(hostId: string, node: HTMLElement): void {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.replaceChildren();
  host.appendChild(node);
  node.classList.remove('hidden');
}

function restoreToCode(record: ReparentRecord): void {
  const { node, codeParent, codeNextSibling } = record;
  if (codeNextSibling && codeNextSibling.parentNode === codeParent) {
    codeParent.insertBefore(node, codeNextSibling);
  } else {
    codeParent.appendChild(node);
  }
  // Desktop drawer strips `.hidden` when mounting; restore each node's Code visibility.
  // Only preview/viewer panes use `.hidden` in Code — not #fileSidebarFilesView.
  node.classList.toggle('hidden', record.codeHadHiddenClass);
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

/** Move shared mounts to desktop drawer hosts or restore to Code layout. */
export async function syncDesktopWorkspaceMounts(): Promise<void> {
  if (repairRightPaneDomStructure()) {
    records = [];
  }
  captureRecords();
  const nextSurface: MountSurface = shouldHostOnDesktop() ? 'desktop' : 'code';
  const surfaceChanged = nextSurface !== mountSurface;
  const listingRootChanged = await applyListingRootForSurface(nextSurface);

  if (surfaceChanged) {
    if (nextSurface === 'desktop') {
      for (const record of records) {
        mountToDesktop(record.desktopHostId, record.node);
      }
      mountSurface = 'desktop';
    } else {
      for (const record of records) {
        restoreToCode(record);
      }
      mountSurface = 'code';
      if (document.getElementById('btnFileSidebarCollapse')) {
        const fileLayout = await import('../ui/file-layout');
        if (isCodeForeground()) {
          const preview = await import('../ui/preview-panel');
          preview.collapsePreviewPanelKeepingSource();
        } else {
          fileLayout.reconcileRightSplitDomWithState();
          fileLayout.applyFileSidebarVisuals();
        }
      }
    }
  }

  if (surfaceChanged || listingRootChanged) {
    await refreshFileTreeForSurface();
  }

  syncDrawerPaneVisibility();
  const previewPanel = await import('../ui/preview-panel');
  await previewPanel.syncPreviewDesignToolbarForSurface();
  if (typeof window !== 'undefined' && window.minnow?.preview) {
    bindResizeObserver();
    const previewVisibility = await import('../ui/preview-electron-visibility');
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
  resizeObserver?.disconnect();
  resizeObserver = null;
}

export { collapseDesktopWorkspacePanel, openDesktopWorkspaceTab };
