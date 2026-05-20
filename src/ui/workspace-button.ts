/**
 * Top bar workspace folder button — pick directory for AI tools.
 */

import { pickWorkspaceFolder } from '../config/workspace-api';
import { patchFilePanelState } from '../state/file-panel';
import { loadWorkspaceFromServer, setWorkspaceFromServer } from '../state/workspace';
import { getLocalServerAvailable } from '../tools/client';
import { invalidateFileTreeCache, refreshFileTree } from './file-tree';
import { setStatus } from './status';

function getWorkspaceButton(): HTMLButtonElement | null {
  return document.getElementById('btnWorkspace') as HTMLButtonElement | null;
}

/** Reflect current workspace on the top bar button. */
export function updateWorkspaceButtonLabel(label: string, fullPath: string): void {
  const btn = getWorkspaceButton();
  if (!btn) return;
  const short = label.trim() || 'Workspace';
  btn.title = fullPath ? `Workspace: ${fullPath}` : 'Choose workspace folder';
  btn.setAttribute('aria-label', `Workspace: ${short}. Click to change folder.`);
}

/** Load workspace from server and refresh top bar + file tree. */
export async function refreshWorkspaceUi(): Promise<void> {
  const info = await loadWorkspaceFromServer();
  if (info?.path) {
    updateWorkspaceButtonLabel(info.label, info.path);
  }
}

async function onWorkspaceFolderChosen(): Promise<void> {
  if (!getLocalServerAvailable()) {
    setStatus('err', 'Workspace requires npm start (local server)');
    return;
  }

  setStatus('spin', 'Choose workspace folder…');
  try {
    const result = await pickWorkspaceFolder();
    if (result.cancelled) {
      setStatus('ok', 'Workspace unchanged');
      return;
    }
    if (!result.path) {
      setStatus(
        'err',
        result.error ?? 'Could not open folder picker. Enter path in Settings later.',
      );
      return;
    }

    setWorkspaceFromServer({
      path: result.path,
      label: result.label ?? result.path,
      isDefault: result.isDefault === true,
    });
    updateWorkspaceButtonLabel(result.label ?? result.path, result.path);

    patchFilePanelState({
      expandedDirs: [],
      selectedPath: null,
    });
    invalidateFileTreeCache();
    await refreshFileTree();

    setStatus('ok', `Workspace: ${result.label ?? result.path}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  }
}

/** Wire top bar workspace folder control. */
export function initWorkspaceButton(): void {
  const btn = getWorkspaceButton();
  if (!btn) return;

  btn.addEventListener('click', () => {
    void onWorkspaceFolderChosen();
  });

  void refreshWorkspaceUi();
}
