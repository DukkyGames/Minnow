/**
 * File sidebar and split-viewer layout (mirrors chat sidebar layout.ts).
 */

import { ICON_CHEVRON_RIGHT, ICON_FILE_TREE } from '../constants';
import {
  getFilePanelState,
  patchFilePanelState,
} from '../state/file-panel';
import { syncStatsStripLayoutForViewer } from './stats';

export function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 640px)').matches;
}

export function closeMobileFileSidebar(): void {
  const side = document.getElementById('fileSidebar');
  const bd = document.getElementById('fileSidebarBackdrop');
  if (side) side.classList.remove('mobile-open');
  if (bd) {
    bd.classList.remove('open');
    bd.setAttribute('aria-hidden', 'true');
    (bd as HTMLButtonElement).tabIndex = -1;
  }
}

export function openMobileFileSidebar(): void {
  if (!isMobileLayout()) return;
  const side = document.getElementById('fileSidebar');
  const bd = document.getElementById('fileSidebarBackdrop');
  if (side) side.classList.add('mobile-open');
  if (bd) {
    bd.classList.add('open');
    bd.setAttribute('aria-hidden', 'false');
    (bd as HTMLButtonElement).tabIndex = 0;
  }
}

function isRightSplitOpen(): boolean {
  const state = getFilePanelState();
  return state.rightPaneMode !== null || state.viewerOpen;
}

/** Apply collapsed rail, mobile overlay, and split ratio CSS variables. */
export function applyFileSidebarVisuals(): void {
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

  if (!side || !btn) return;

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
  const previewPane = document.getElementById('previewPane');
  const resizer = document.getElementById('splitResizer');
  if (previewPane) previewPane.classList.remove('hidden');
  if (resizer) resizer.classList.remove('hidden');
  patchFilePanelState({ rightPaneMode: 'preview', viewerOpen: true });
  applyFileSidebarVisuals();
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
