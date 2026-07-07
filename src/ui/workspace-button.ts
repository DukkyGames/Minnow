/**
 * Top bar workspace folder button — recent workspaces menu + in-app folder picker.
 */

import type { WorkspaceInfo } from '../config/workspace-api';
import { executeWorkspaceSwitch, dismissBoardViewOutsideWorkspace } from './workspace-switch-guard';
import { patchFilePanelState } from '../state/file-panel';
import {
  getWorkspacePath,
  loadWorkspaceFromServer,
  setWorkspaceFromServer,
} from '../state/workspace';
import { getLocalServerAvailable } from '../tools/client';
import { clearCachesForWorkspace } from '../tools/result-cache';
import { refreshFileTreeViaBridge } from './file-tree-refresh-bridge';
import { setStatus } from './status';
import { applyWorkspaceScopedSession } from './sidebar';
import { openWorkspaceFolderPicker } from './workspace-folder-picker';
import {
  closeWorkspaceMenu,
  configureWorkspaceRecentMenu,
  setWorkspaceMenuDeps,
  toggleWorkspaceMenu,
} from './workspace-recent-menu';

function getWorkspaceButton(): HTMLButtonElement | null {
  return document.getElementById('btnWorkspace') as HTMLButtonElement | null;
}

function getWorkspacePathLabel(): HTMLElement | null {
  return document.getElementById('workspacePathLabel');
}

/** Reflect current workspace on the top bar button and path label. */
export function updateWorkspaceButtonLabel(label: string, fullPath: string): void {
  const btn = getWorkspaceButton();
  if (!btn) return;
  const short = label.trim() || 'Workspace';
  const path = fullPath.trim();
  btn.title = path ? `Workspace: ${path}` : 'Choose workspace folder';
  btn.setAttribute('aria-label', `Workspace: ${short}. Click to open recent workspaces.`);
  btn.setAttribute('aria-haspopup', 'menu');

  const pathLabel = getWorkspacePathLabel();
  if (!pathLabel) return;
  if (path) {
    pathLabel.textContent = path;
    pathLabel.title = path;
    pathLabel.hidden = false;
    btn.setAttribute('aria-describedby', 'workspacePathLabel');
  } else {
    pathLabel.textContent = '';
    pathLabel.removeAttribute('title');
    pathLabel.hidden = true;
    btn.removeAttribute('aria-describedby');
  }
}

/**
 * Shared refresh after PUT, native picker, or recent-workspace menu — label, file tree, chats.
 */
export async function applyWorkspaceSwitch(info: WorkspaceInfo): Promise<void> {
  const previousPath = getWorkspacePath();
  await dismissBoardViewOutsideWorkspace(info.path);
  clearCachesForWorkspace(previousPath);
  setWorkspaceFromServer(info);
  updateWorkspaceButtonLabel(info.label, info.path);
  const { teardownCodeBrainMapBeforeChatPaint } = await import('./code-brain-map');
  const closedCodeMap = teardownCodeBrainMapBeforeChatPaint();
  applyWorkspaceScopedSession(info.path, previousPath);
  if (closedCodeMap) {
    const { getActiveChat } = await import('../state/sessions');
    const { renderChatFromHistory } = await import('./messages');
    renderChatFromHistory(getActiveChat());
  }

  const { closeFileViewerForce } = await import('./file-viewer');
  closeFileViewerForce();
  patchFilePanelState({
    expandedDirs: [],
    selectedPath: null,
    openViewerTabs: [],
    activeViewerTab: null,
  });
  const { syncFileTreeToPanelWorktree } = await import('./file-tree');
  await syncFileTreeToPanelWorktree(undefined);
  await refreshFileTreeViaBridge();

  setStatus('ok', `Workspace: ${info.label}`);
  const { refreshHubLiveData } = await import('./hub');
  refreshHubLiveData();
}

/** Load workspace from server and refresh top bar + file tree. */
export async function refreshWorkspaceUi(): Promise<void> {
  const info = await loadWorkspaceFromServer();
  if (info?.path) {
    updateWorkspaceButtonLabel(info.label, info.path);
  }
}

/** Guarded workspace switch used by the top bar, welcome page, and deep links. */
export { executeWorkspaceSwitch } from './workspace-switch-guard';

async function onOpenNewWorkspace(): Promise<void> {
  if (!getLocalServerAvailable()) {
    setStatus('err', 'Workspace requires npm start (local server)');
    return;
  }

  setStatus('spin', 'Choose workspace folder…');
  try {
    const initialPath = getWorkspacePath();
    const result = await openWorkspaceFolderPicker({
      initialPath: initialPath || undefined,
    });
    if (result.cancelled) {
      setStatus('ok', 'Workspace unchanged');
      return;
    }
    if (!result.path) {
      setStatus('err', 'No folder selected');
      return;
    }

    const info = await executeWorkspaceSwitch(result.path);
    if (!info) {
      setStatus('ok', 'Workspace unchanged');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  }
}

/** Wire top bar workspace folder control. */
export function initWorkspaceButton(): void {
  const btn = getWorkspaceButton();
  if (!btn) return;

  setWorkspaceMenuDeps({
    isServerAvailable: getLocalServerAvailable,
    reportStatus: setStatus,
  });

  configureWorkspaceRecentMenu({
    onSelectWorkspace: async (absPath) => {
      const info = await executeWorkspaceSwitch(absPath);
      if (!info) {
        setStatus('ok', 'Workspace unchanged');
      }
    },
    onOpenNew: onOpenNewWorkspace,
  });

  btn.addEventListener('click', () => {
    void toggleWorkspaceMenu(btn);
  });

  void refreshWorkspaceUi();
}

export { closeWorkspaceMenu };
