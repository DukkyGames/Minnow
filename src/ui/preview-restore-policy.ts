/**
 * When the in-app browser / file-viewer split auto-opens vs stays closed (MIN-342).
 *
 * Code app entry defaults to a closed right split so stale Electron guests,
 * desktop drawer reparenting, and orphan localhost URLs do not surprise users.
 * Desktop drawer restore and explicit toggles still reopen the last state.
 */

import { getDesktopWorkspacePanelState } from '../os/desktop-workspace-state';
import { getForegroundAppId, getOsView } from '../os/instances';
import { isOsShellEnabled } from '../os/page-bridge';
import { getFilePanelState } from '../state/file-panel';

/** True when Code is the active fullscreen Minnow app. */
export function isCodeAppForeground(): boolean {
  return getOsView() === 'app' && getForegroundAppId() === 'code';
}

/**
 * Whether initPreviewPanel should reopen a persisted preview split.
 * Desktop browser drawer: yes. Code app / stale persisted state: no.
 */
export function shouldAutoRestorePreviewPanel(): boolean {
  const state = getFilePanelState();
  if (state.rightPaneMode !== 'preview') return false;

  // Legacy full-page mode (no OS shell): keep reload restore behavior.
  if (!isOsShellEnabled()) return true;

  const desktopPanel = getDesktopWorkspacePanelState();
  if (desktopPanel.open && desktopPanel.tab === 'browser' && !isCodeAppForeground()) {
    return true;
  }

  return false;
}

/**
 * Whether initFilePanel should reopen persisted file-viewer tabs.
 * Desktop file-preview drawer: yes. Code app entry: no (both panes start closed).
 */
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

/**
 * Whether passive Electron preview IPC (did-navigate) may auto-open the split.
 * Agent browser_* tools call showPreviewSplit first (rightPaneMode = preview).
 * After Code entry collapse (MIN-342), rightPaneMode is null — ignore stale guest events.
 */
export function shouldAutoRevealPreviewOnNavigation(): boolean {
  if (!isOsShellEnabled()) return true;
  return getFilePanelState().rightPaneMode === 'preview';
}
