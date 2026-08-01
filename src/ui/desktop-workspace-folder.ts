/**
 * Desktop chat workspace folder switch — picker, MRU, and UI refresh.
 */

import { fetchWorkspace } from '../config/workspace-api';
import {
  getCachedDesktopWorkspaceLabel,
  getCachedDesktopWorkspacePath,
  getDesktopWorkspacePath,
  resetDesktopWorkspacePathCache,
  setDesktopWorkspacePath,
} from '../lib/desktop-workspace';
import { activateDesktopAssistantChatForApp } from '../state/sessions';
import { getLocalServerAvailable } from '../tools/client';
import { clearCachesForWorkspace } from '../tools/result-cache';
import { openWorkspaceFolderPicker } from './workspace-folder-picker';
import { setStatus } from './status';
import { renderDesktopChatMessages } from '../os/desktop-chat';
import { renderDesktopChatRail } from './desktop-chat-rail';
import { refreshDesktopWorkspaceDrawerPath } from '../os/desktop-workspace-rail';
import { syncDesktopWorkspaceMounts } from '../os/desktop-workspace-mounts';
import { clearPanelCwdUserOverride, syncPanelFromActiveChat } from './git-panel';
import { refreshContextUsageRing } from './context-usage-ring';
import { syncChatItemDotsInDom } from './chat-item-dot';
import { syncComposerFromStreamingState } from './composer-send';

/** Update drawer path label and button chrome after a switch. */
export function refreshDesktopWorkspaceFolderUi(): void {
  const path = getCachedDesktopWorkspacePath();
  const label = getCachedDesktopWorkspaceLabel();
  const pathEl = document.getElementById('desktopWorkspaceDrawerPath');
  if (pathEl && path) {
    pathEl.textContent = path;
    pathEl.title = path;
  }
  const btn = document.getElementById('btnDesktopWorkspaceFolder');
  if (btn && path) {
    const short = label?.trim() || 'Workspace';
    btn.title = `Workspace: ${path}`;
    btn.setAttribute('aria-label', `Workspace: ${short}. Click to change folder.`);
  }
}

/** Shared refresh after PUT or folder picker — sessions, file tree, drawer label. */
export async function applyDesktopWorkspaceSwitch(
  info: { path: string; label?: string },
  previousPath?: string,
): Promise<void> {
  const prev = previousPath?.trim() || getCachedDesktopWorkspacePath() || '';
  clearCachesForWorkspace(prev);
  const { renderChatFromHistory } = await import('./messages');
  const { getActiveChat } = await import('../state/sessions');
  const chat = activateDesktopAssistantChatForApp(info.path);
  renderDesktopChatRail(info.path);
  renderDesktopChatMessages();
  renderChatFromHistory(chat);
  clearPanelCwdUserOverride();
  syncPanelFromActiveChat({ forceFileTree: true });
  await syncDesktopWorkspaceMounts();
  syncComposerFromStreamingState();
  syncChatItemDotsInDom();
  refreshContextUsageRing();
  refreshDesktopWorkspaceFolderUi();
  void import('../tools/stream-chat-dom').then((m) =>
    m.remountStreamDomForChat(getActiveChat().id),
  );
  const short = info.label?.trim() || info.path.split(/[/\\]/).filter(Boolean).pop() || info.path;
  setStatus('ok', `Desktop workspace: ${short}`);
}

/** Set desktop workspace by absolute path (server-validated). */
export async function executeDesktopWorkspaceSwitch(
  absPath: string,
): Promise<{ path: string; label?: string } | null> {
  const previousPath = await getDesktopWorkspacePath();
  const info = await setDesktopWorkspacePath(absPath);
  await applyDesktopWorkspaceSwitch(info, previousPath ?? undefined);
  return info;
}

async function onOpenDesktopWorkspaceFolder(): Promise<void> {
  if (!getLocalServerAvailable()) {
    setStatus('err', 'Workspace requires Minnow running locally');
    return;
  }

  setStatus('spin', 'Choose workspace folder…');
  try {
    const initialPath = (await getDesktopWorkspacePath()) || undefined;
    const result = await openWorkspaceFolderPicker({ initialPath });
    if (result.cancelled) {
      setStatus('ok', 'Workspace unchanged');
      return;
    }
    if (!result.path) {
      setStatus('err', 'No folder selected');
      return;
    }

    await executeDesktopWorkspaceSwitch(result.path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  }
}

/** Populate the desktop workspace MRU <select> from server workspace list. */
export async function refreshDesktopWorkspaceSelect(
  select: HTMLSelectElement | null,
): Promise<void> {
  if (!select) return;
  const currentPath = (await getDesktopWorkspacePath()) ?? '';
  const info = await fetchWorkspace();
  const recent = info?.recent?.filter((item) => item.exists) ?? [];
  const selectedPath = select.value?.trim() || currentPath;
  select.replaceChildren();

  const paths = new Map<string, string>();
  if (currentPath) {
    paths.set(currentPath, getCachedDesktopWorkspaceLabel() ?? currentPath);
  }
  for (const item of recent) {
    paths.set(item.path, item.label);
  }
  if (selectedPath && !paths.has(selectedPath)) {
    paths.set(selectedPath, selectedPath.split(/[/\\]/).filter(Boolean).pop() ?? selectedPath);
  }

  for (const [path, label] of paths) {
    const opt = document.createElement('option');
    opt.value = path;
    opt.textContent = label;
    if (path === currentPath) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
  if (selectedPath) {
    select.value = selectedPath;
  }
}

/** Wire desktop workspace folder controls in the workspace drawer. */
export function initDesktopWorkspaceFolderControls(): void {
  const browseBtn = document.getElementById('btnDesktopWorkspaceFolder');
  if (browseBtn && browseBtn.dataset.bound !== '1') {
    browseBtn.dataset.bound = '1';
    browseBtn.addEventListener('click', () => {
      void onOpenDesktopWorkspaceFolder();
    });
  }

  const select = document.getElementById(
    'desktopWorkspaceSelect',
  ) as HTMLSelectElement | null;
  if (select && select.dataset.bound !== '1') {
    select.dataset.bound = '1';
    select.addEventListener('change', () => {
      const next = select.value?.trim();
      if (!next) return;
      void executeDesktopWorkspaceSwitch(next).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setStatus('err', message);
      });
    });
    void refreshDesktopWorkspaceSelect(select);
  }

  void refreshDesktopWorkspaceDrawerPath();
  refreshDesktopWorkspaceFolderUi();
}

/** Test helper — reset cached path before re-fetching. */
export function resetDesktopWorkspaceSwitchForTests(): void {
  resetDesktopWorkspacePathCache();
}
