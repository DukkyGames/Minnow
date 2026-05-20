/**
 * File sidebar and split-viewer layout (mirrors chat sidebar layout.ts).
 */

import { ICON_CHEVRON_LEFT, ICON_CHEVRON_RIGHT } from '../constants';
import {
  getFilePanelState,
  patchFilePanelState,
} from '../state/file-panel';

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

/** Apply collapsed rail, mobile overlay, and split ratio CSS variables. */
export function applyFileSidebarVisuals(): void {
  const side = document.getElementById('fileSidebar');
  const btn = document.getElementById('btnFileSidebarCollapse');
  const state = getFilePanelState();
  const split = document.getElementById('workspaceSplit');

  if (split) {
    split.classList.toggle('viewer-open', state.viewerOpen);
    split.style.setProperty('--split-ratio', String(state.splitRatio));
  }

  if (!side || !btn) return;

  if (!isMobileLayout()) {
    closeMobileFileSidebar();
    side.classList.toggle('collapsed', state.fileSidebarCollapsed);
    btn.innerHTML = state.fileSidebarCollapsed ? ICON_CHEVRON_LEFT : ICON_CHEVRON_RIGHT;
    btn.setAttribute(
      'aria-label',
      state.fileSidebarCollapsed ? 'Expand file tree' : 'Collapse file tree',
    );
  } else {
    side.classList.toggle('collapsed', state.fileSidebarCollapsed);
    btn.innerHTML = side.classList.contains('mobile-open')
      ? ICON_CHEVRON_RIGHT
      : ICON_CHEVRON_LEFT;
    btn.setAttribute(
      'aria-label',
      side.classList.contains('mobile-open') ? 'Close file tree' : 'Open file tree',
    );
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

/** Show split viewer pane and resizer. */
export function showViewerSplit(): void {
  const pane = document.getElementById('fileViewerPane');
  const resizer = document.getElementById('splitResizer');
  if (pane) pane.classList.remove('hidden');
  if (resizer) resizer.classList.remove('hidden');
  patchFilePanelState({ viewerOpen: true });
  applyFileSidebarVisuals();
}

/** Hide split viewer pane and resizer. */
export function hideViewerSplit(): void {
  const pane = document.getElementById('fileViewerPane');
  const resizer = document.getElementById('splitResizer');
  if (pane) pane.classList.add('hidden');
  if (resizer) resizer.classList.add('hidden');
  patchFilePanelState({ viewerOpen: false });
  applyFileSidebarVisuals();
}
