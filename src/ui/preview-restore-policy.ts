/**
 * When the in-app browser preview auto-opens vs stays closed (MIN-342).
 *
 * Code app entry defaults to a closed panel so stale Electron guests and
 * orphan localhost URLs do not surprise users. Desktop browser drawer restore
 * and explicit #btnPreviewToggle still reopen the last previewSource.
 */

import { getDesktopWorkspacePanelState } from '../os/desktop-workspace-state';
import { getForegroundAppId, getOsView } from '../os/instances';
import { isOsShellEnabled } from '../os/page-bridge';
import { getFilePanelState } from '../state/file-panel';

/** True when Code is the active fullscreen MinnowOS app. */
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
