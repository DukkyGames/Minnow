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
  clearMobileFileSidebarOverlay,
  closeMobileFileSidebar,
  isMobileLayout,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
} from './file-layout';
import { initFileTreeDnD } from './file-tree-dnd';
import {
  initFileTreeCrud,
  initFileTreeIfNeeded,
  invalidateFileTreeCache,
  refreshFileTree,
  renderFileTree,
} from './file-tree';
import { registerFileTreeRefreshBridge } from './file-tree-refresh-bridge';
import { setFileTreeServerAvailable } from './file-tree-server';
import {
  initFileTreeSearch,
  onFileTreeSearchServerChanged,
  registerFileTreeFilterRender,
  registerFileTreeServerCheck,
} from './file-tree-search';
import {
  bindFileViewerControls,
  bindFileViewerContextMenu,
  closeFileViewer,
  openFileInViewer,
  restoreViewerTabsFromPrefs,
} from './file-viewer';
import { bindFileViewerTabs } from './file-viewer-tabs';
import { isLocalServerAvailable } from '../tools/config';
import { getLocalServerAvailable } from '../tools/client';
import { refreshWorkspaceUi } from './workspace-button';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import { initGitPanel, syncPanelFromActiveChat } from './git-panel';
import { syncComposerRunTargetFromActiveChat } from './composer-run-target';
import { initGitCenterLightbox } from './git-center-lightbox';
import { initGitHelpLightbox } from './git-help-lightbox';
import { startFileTreeGitStatusPoll } from './file-tree';
import {
  shouldAutoRestoreViewerSplitOnBoot,
} from './preview-restore-policy';
import { bindWorkspaceSplitResizer } from './workspace-split-resize';
import { sessionState } from '../state/sessions';

let resizerBound = false;

function bindSplitResizer(): void {
  if (resizerBound) return;
  resizerBound = true;
  bindWorkspaceSplitResizer();
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
    if (typeof document !== 'undefined' && document.getElementById('fileTreeHost')) {
      void refreshFileTree();
    }
    if (!sessionState) return;
    void refreshWorkspaceUi();
    void syncOrchestratePlanStripFromActiveChat();
    syncViewModeToggleFromActiveChat();
    syncPanelFromActiveChat({ forceFileTree: true });
    syncComposerRunTargetFromActiveChat();
    startFileTreeGitStatusPoll();
  } else {
    renderFileTree();
  }
}

/** Initialize file panel after detectLocalServer(). */
export async function initFilePanel(): Promise<void> {
  registerFileTreeRefreshBridge({
    refresh: refreshFileTree,
    render: renderFileTree,
    invalidateCache: invalidateFileTreeCache,
  });

  await loadFilePanelPrefs();
  setFileTreeServerAvailable(getLocalServerAvailable());
  if (getLocalServerAvailable()) {
    void initFileTreeIfNeeded();
  }

  const { initPreviewPanel } = await import('./preview-panel');
  await initPreviewPanel();

  const state = getFilePanelState();
  if (shouldAutoRestoreViewerSplitOnBoot()) {
    if (state.openViewerTabs.length > 0) {
      await restoreViewerTabsFromPrefs(state.openViewerTabs, state.activeViewerTab);
    } else if (state.viewerOpen && state.selectedPath) {
      await openFileInViewer(state.selectedPath);
    }
  }

  applyFileSidebarVisuals();

  bindSplitResizer();
  bindFilePanelControls();
  bindFileViewerControls();
  bindFileViewerTabs();
  bindFileViewerContextMenu();
  initFileTreeCrud();
  initFileTreeDnD();
  registerFileTreeFilterRender(renderFileTree);
  registerFileTreeServerCheck(isLocalServerAvailable);
  initFileTreeSearch();

  initGitPanel();
  initGitCenterLightbox();
  initGitHelpLightbox();
  if (getLocalServerAvailable()) {
    startFileTreeGitStatusPoll();
  }

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) clearMobileFileSidebarOverlay();
    applyFileSidebarVisuals();
  });
}

export {
  applyFileSidebarVisuals,
  clearMobileFileSidebarOverlay,
  closeMobileFileSidebar,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
};
