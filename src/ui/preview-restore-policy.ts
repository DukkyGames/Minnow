import { getDesktopWorkspacePanelState } from '../os/desktop-workspace-state';
import { getForegroundAppId, getOsView } from '../os/instances';
import { isOsShellEnabled } from '../os/page-bridge';
import { getFilePanelState } from '../state/file-panel';

/** True when Code is the active fullscreen Minnow app. */
export function isCodeAppForeground(): boolean {
  return getOsView() === 'app' && getForegroundAppId() === 'code';
}

/** Whether initPreviewPanel should reopen a persisted preview split. */
export function shouldAutoRestorePreviewPanel(): boolean {
  const state = getFilePanelState();
  if (state.rightPaneMode !== 'preview') return false;

  if (!isOsShellEnabled()) return true;

  const desktopPanel = getDesktopWorkspacePanelState();
  if (desktopPanel.open && desktopPanel.tab === 'browser' && !isCodeAppForeground()) {
    return true;
  }

  return false;
}

/** Whether initFilePanel should reopen persisted file-viewer tabs. */
export function shouldAutoRestoreViewerSplitOnBoot(): boolean {
  const state = getFilePanelState();
  const hasViewer =
    state.rightPaneMode === 'viewer' ||
    state.openViewerTabs.length > 0 ||
    (state.viewerOpen && Boolean(state.selectedPath));
  if (!hasViewer) return false;

  if (!isOsShellEnabled()) return true;

  if (isCodeAppForeground()) return false;

  const desktopPanel = getDesktopWorkspacePanelState();
  if (desktopPanel.open && desktopPanel.tab === 'viewer') {
    return true;
  }

  return state.rightPaneMode === 'viewer';
}

/** Whether passive Electron preview IPC (did-navigate) may auto-open the split. */
export function shouldAutoRevealPreviewOnNavigation(): boolean {
  if (!isOsShellEnabled()) return true;
  return getFilePanelState().rightPaneMode === 'preview';
}
