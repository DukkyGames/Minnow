/**
 * File sidebar and split-viewer layout (mirrors chat sidebar layout.ts).
 */

import { ICON_CHEVRON_RIGHT, ICON_FILE_TREE } from '../constants';
import {
  getFilePanelState,
  patchFilePanelState,
  type RightPaneMode,
} from '../state/file-panel';
import { syncStatsStripLayoutForViewer } from './stats';
import { clearAllViewerTabs } from './file-viewer-tab-store';
import { mountOsMobileDrawerBackdrops, syncOsMobileDrawerHtmlClass } from './mobile-drawer-portal';

export function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 640px)').matches;
}

export function closeMobileFileSidebar(): void {
  const side = document.getElementById('fileSidebar');
  const bd = document.getElementById('fileSidebarBackdrop');
  if (side) side.classList.remove('mobile-open');
  syncOsMobileDrawerHtmlClass('file', false);
  if (bd) {
    bd.classList.remove('open');
    bd.setAttribute('aria-hidden', 'true');
    (bd as HTMLButtonElement).tabIndex = -1;
  }
}

export function openMobileFileSidebar(): void {
  if (!isMobileLayout()) return;
  mountOsMobileDrawerBackdrops();
  const side = document.getElementById('fileSidebar');
  const bd = document.getElementById('fileSidebarBackdrop');
  if (side) side.classList.add('mobile-open');
  syncOsMobileDrawerHtmlClass('file', true);
  if (bd) {
    bd.classList.add('open');
    bd.setAttribute('aria-hidden', 'false');
    (bd as HTMLButtonElement).tabIndex = 0;
  }
}

function resolvedRightPaneMode(): RightPaneMode {
  const state = getFilePanelState();
  if (state.rightPaneMode === 'preview' || state.rightPaneMode === 'viewer') {
    return state.rightPaneMode;
  }
  return state.viewerOpen ? 'viewer' : null;
}

/** True when the preview or viewer pane is actually visible (not only persisted as open). */
function isRightPaneDomVisible(mode: Exclude<RightPaneMode, null>): boolean {
  const paneId = mode === 'preview' ? 'previewPane' : 'fileViewerPane';
  const pane = document.getElementById(paneId);
  return Boolean(pane && !pane.classList.contains('hidden'));
}

function isRightSplitOpen(): boolean {
  const mode = resolvedRightPaneMode();
  if (mode === null) return false;
  return isRightPaneDomVisible(mode);
}

/**
 * Unhide the pane matching persisted rightPaneMode when state and DOM diverge
 * (e.g. reload applied viewer-open before preview restore, or Code foreground).
 */
export function reconcileRightSplitDomWithState(): void {
  const mode = resolvedRightPaneMode();
  if (mode === 'preview' && !isRightPaneDomVisible('preview')) {
    showPreviewSplit();
    schedulePreviewGuestResyncAfterReconcile();
    return;
  }
  if (mode === 'viewer' && !isRightPaneDomVisible('viewer')) {
    hidePreviewPaneDom();
    void window.minnow?.preview.hide();
    document.getElementById('fileViewerPane')?.classList.remove('hidden');
    document.getElementById('splitResizer')?.classList.remove('hidden');
  }
}

/** Sync Electron preview guest bounds after workspace split geometry changes. */
function scheduleElectronPreviewHostLayoutAfterSplitChange(): void {
  if (getFilePanelState().rightPaneMode !== 'preview') return;
  void import('./preview-electron-visibility').then((m) => {
    m.scheduleElectronPreviewHostLayoutSync();
  });
}

/** Re-show Chromium guest + reload source after reconcile unhides the preview pane. */
function schedulePreviewGuestResyncAfterReconcile(): void {
  if (getFilePanelState().rightPaneMode !== 'preview') return;
  void import('./preview-panel').then((m) => {
    m.resyncOpenPreviewPanelFromState({ reload: true });
  });
}

/** Apply collapsed rail, mobile overlay, and split ratio CSS variables. */
export function applyFileSidebarVisuals(): void {
  reconcileRightSplitDomWithState();

  const side = document.getElementById('fileSidebar');
  const btn = document.getElementById('btnFileSidebarCollapse');
  const state = getFilePanelState();
  const split = document.getElementById('workspaceSplit');
  const splitOpen = isRightSplitOpen();

  if (split) {
    split.classList.toggle('viewer-open', splitOpen);
    split.style.setProperty('--split-ratio', String(state.splitRatio));
    syncStatsStripLayoutForViewer(splitOpen);
  }
  scheduleElectronPreviewHostLayoutAfterSplitChange();

  if (!side || !btn) return;

  if (isMobileLayout()) {
    mountOsMobileDrawerBackdrops();
    syncOsMobileDrawerHtmlClass('file', side.classList.contains('mobile-open'));
  } else {
    syncOsMobileDrawerHtmlClass('file', false);
  }

  if (!isMobileLayout()) {
    closeMobileFileSidebar();
    side.classList.toggle('collapsed', state.fileSidebarCollapsed);
    btn.innerHTML = state.fileSidebarCollapsed ? ICON_FILE_TREE : ICON_CHEVRON_RIGHT;
    btn.setAttribute(
      'aria-label',
      state.fileSidebarCollapsed ? 'Expand file tree' : 'Collapse file tree',
    );
    btn.setAttribute(
      'title',
      state.fileSidebarCollapsed ? 'Expand file tree' : 'Collapse file tree',
    );
  } else {
    side.classList.toggle('collapsed', state.fileSidebarCollapsed);
    const open = side.classList.contains('mobile-open');
    btn.innerHTML = open ? ICON_CHEVRON_RIGHT : ICON_FILE_TREE;
    btn.setAttribute('aria-label', open ? 'Close file tree' : 'Open file tree');
    btn.setAttribute('title', open ? 'Close file tree' : 'Open file tree');
  }

  const previewBtn = document.getElementById('btnPreviewToggle');
  if (previewBtn) {
    const previewOpen = state.rightPaneMode === 'preview';
    previewBtn.classList.toggle('is-active', previewOpen);
    previewBtn.setAttribute('aria-pressed', previewOpen ? 'true' : 'false');
  }
}

export function toggleFileSidebarLayout(): void {
  if (isMobileLayout()) {
    const side = document.getElementById('fileSidebar');
    if (side && side.classList.contains('mobile-open')) {
      closeMobileFileSidebar();
    } else {
      openMobileFileSidebar();
    }
    applyFileSidebarVisuals();
    return;
  }

  const state = getFilePanelState();
  patchFilePanelState({ fileSidebarCollapsed: !state.fileSidebarCollapsed });
  applyFileSidebarVisuals();
}

export function toggleFileSidebarCollapsed(): void {
  if (isMobileLayout()) {
    closeMobileFileSidebar();
    applyFileSidebarVisuals();
    return;
  }
  const state = getFilePanelState();
  patchFilePanelState({ fileSidebarCollapsed: !state.fileSidebarCollapsed });
  applyFileSidebarVisuals();
}

/** Hide preview pane DOM only (does not change persisted split state). */
export function hidePreviewPaneDom(): void {
  const previewPane = document.getElementById('previewPane');
  if (previewPane) previewPane.classList.add('hidden');
}

/** Hide file viewer pane DOM only (does not change persisted split state). */
export function hideViewerPaneDom(): void {
  const pane = document.getElementById('fileViewerPane');
  if (pane) pane.classList.add('hidden');
}

/** Show split viewer pane and resizer; closes preview if open. */
export function showViewerSplit(): void {
  hidePreviewPaneDom();
  void window.minnow?.preview.hide();
  const pane = document.getElementById('fileViewerPane');
  const resizer = document.getElementById('splitResizer');
  if (pane) pane.classList.remove('hidden');
  if (resizer) resizer.classList.remove('hidden');
  patchFilePanelState({ rightPaneMode: 'viewer', viewerOpen: true });
  applyFileSidebarVisuals();
}

/** Hide split viewer pane and resizer. */
export function hideViewerSplit(): void {
  hideViewerPaneDom();
  const resizer = document.getElementById('splitResizer');
  if (resizer) resizer.classList.add('hidden');
  patchFilePanelState({ rightPaneMode: null, viewerOpen: false });
  applyFileSidebarVisuals();
}

/** Show preview pane and resizer; closes file viewer if open. */
export function showPreviewSplit(): void {
  hideViewerPaneDom();
  clearAllViewerTabs();
  patchFilePanelState({
    rightPaneMode: 'preview',
    viewerOpen: true,
    openViewerTabs: [],
    activeViewerTab: null,
  });
  const previewPane = document.getElementById('previewPane');
  const resizer = document.getElementById('splitResizer');
  if (previewPane) previewPane.classList.remove('hidden');
  if (resizer) resizer.classList.remove('hidden');
  applyFileSidebarVisuals();
  scheduleElectronPreviewHostLayoutAfterSplitChange();
}

/** Hide preview pane and resizer. */
export function hidePreviewSplit(): void {
  hidePreviewPaneDom();
  void window.minnow?.preview.hide();
  const resizer = document.getElementById('splitResizer');
  if (resizer) resizer.classList.add('hidden');
  patchFilePanelState({ rightPaneMode: null, viewerOpen: false, previewSource: null });
  applyFileSidebarVisuals();
}
