/**
 * Wire file tree sidebar, split viewer, and resizer after app boot.
 */

import {
  getFilePanelState,
  loadFilePanelPrefs,
  patchFilePanelState,
} from '../state/file-panel';
import {
  applyFileSidebarVisuals,
  closeMobileFileSidebar,
  isMobileLayout,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
} from './file-layout';
import { initFileTreeDnD } from './file-tree-dnd';
import { initFileTreeCrud, initFileTreeIfNeeded, refreshFileTree, renderFileTree } from './file-tree';
import { setFileTreeServerAvailable } from './file-tree-server';
import {
  initFileTreeSearch,
  onFileTreeSearchServerChanged,
  registerFileTreeFilterRender,
  registerFileTreeServerCheck,
} from './file-tree-search';
import { bindFileViewerControls, closeFileViewer, openFileInViewer } from './file-viewer';
import { isLocalServerAvailable } from '../tools/config';
import { getLocalServerAvailable } from '../tools/client';
import { refreshWorkspaceUi } from './workspace-button';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';

let resizerBound = false;

function bindSplitResizer(): void {
  if (resizerBound) return;
  const resizer = document.getElementById('splitResizer');
  const split = document.getElementById('workspaceSplit');
  if (!resizer || !split) return;
  resizerBound = true;

  let dragging = false;

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const rect = split.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const clamped = Math.min(0.75, Math.max(0.35, ratio));
    patchFilePanelState({ splitRatio: clamped });
    applyFileSidebarVisuals();
    resizer.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
  };

  const stopDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
  };

  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  });
}

function bindFilePanelControls(): void {
  const refreshBtn = document.getElementById('btnFileTreeRefresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      void refreshFileTree();
    });
  }

  const closeBtn = document.getElementById('btnFileViewerClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeFileViewer());
  }

  const toggleBtn = document.getElementById('btnFileSidebarCollapse');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      void initFileTreeIfNeeded();
    });
  }
}

/** React to local server ping success/failure (after detectLocalServer). */
export function onFilePanelServerAvailabilityChanged(): void {
  setFileTreeServerAvailable(getLocalServerAvailable());
  onFileTreeSearchServerChanged();
  if (getLocalServerAvailable()) {
    void refreshWorkspaceUi();
    void refreshFileTree();
    void syncOrchestratePlanStripFromActiveChat();
  } else {
    renderFileTree();
  }
}

/** Initialize file panel after detectLocalServer(). */
export async function initFilePanel(): Promise<void> {
  await loadFilePanelPrefs();
  setFileTreeServerAvailable(getLocalServerAvailable());
  if (getLocalServerAvailable()) {
    void initFileTreeIfNeeded();
  }
  applyFileSidebarVisuals();

  const state = getFilePanelState();
  if (state.viewerOpen && state.selectedPath) {
    await openFileInViewer(state.selectedPath);
  }

  bindSplitResizer();
  bindFilePanelControls();
  bindFileViewerControls();
  initFileTreeCrud();
  initFileTreeDnD();
  registerFileTreeFilterRender(renderFileTree);
  registerFileTreeServerCheck(isLocalServerAvailable);
  initFileTreeSearch();

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) closeMobileFileSidebar();
    applyFileSidebarVisuals();
  });
}

export {
  applyFileSidebarVisuals,
  closeMobileFileSidebar,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
};
