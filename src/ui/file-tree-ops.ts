import { appAlert, appConfirm, appPrompt } from './app-dialog';
/**
 * File tree CRUD — executes workspace tools, updates panel state, syncs viewer.
 */

import { getActiveChat, scheduleSaveSessions } from '../state/sessions';
import { isLocalServerAvailable } from '../tools/config';
import { getFilePanelState, patchFilePanelState } from '../state/file-panel';
import { setStatus } from './status';
import {
  clearFileTreeClipboard,
  getFileTreeClipboard,
  setFileTreeClipboard,
} from './file-tree-clipboard';
import { parseToolResult } from './file-tree-parse-result';
import { refreshFileTreeViaBridge } from './file-tree-refresh-bridge';
import {
  basename,
  dirname,
  isAncestorPath,
  isValidEntryName,
  joinTreePath,
  normalizeTreePath,
  pruneExpandedDirs,
  remapExpandedDirs,
} from './file-tree-path';

export type FileTreeEntryKind = 'file' | 'dir';

export type { FileTreeClipboard } from './file-tree-clipboard';
export { parseToolResult } from './file-tree-parse-result';
export {
  clearFileTreeClipboard,
  getFileTreeClipboard,
  setFileTreeClipboard,
} from './file-tree-clipboard';

export type FileTreeMutationOp = 'delete' | 'rename' | 'move' | 'create';

/** Run a server file tool and surface status for the file tree UI. */
export async function runFileTreeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  if (!isLocalServerAvailable()) {
    return { ok: false, message: 'Start with npm start to use file tools.' };
  }
  try {
    const { executeTool } = await import('../tools/client');
    const { buildFileTreeToolContext } = await import('./file-tree-listing-root');
    const chatId = getActiveChat()?.id;
    const toolContext = {
      ...buildFileTreeToolContext(),
      ...(chatId ? { chatId } : {}),
    };
    const { content } = await executeTool(name, args, toolContext);
    if (chatId) scheduleSaveSessions();
    const parsed = parseToolResult(content);
    if (parsed.ok) {
      setStatus('ok', parsed.message);
    } else {
      setStatus('err', parsed.message);
    }
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
    return { ok: false, message };
  }
}

/** Update expandedDirs and selectedPath after delete/rename/move. */
export function applyPathChangeToFilePanelState(
  oldPath: string | null,
  newPath: string | null,
): void {
  if (!oldPath) return;
  const state = getFilePanelState();
  let expandedDirs = remapExpandedDirs(state.expandedDirs, oldPath, newPath);
  let selectedPath = state.selectedPath;

  const oldNorm = normalizeTreePath(oldPath);
  if (selectedPath) {
    const selNorm = normalizeTreePath(selectedPath);
    if (newPath === null) {
      if (selNorm === oldNorm || isAncestorPath(oldNorm, selNorm)) {
        selectedPath = null;
      }
    } else {
      const newNorm = normalizeTreePath(newPath);
      if (selNorm === oldNorm) {
        selectedPath = newNorm;
      } else if (isAncestorPath(oldNorm, selNorm)) {
        selectedPath = newNorm + selNorm.slice(oldNorm.length);
      }
    }
  }

  if (newPath === null) {
    expandedDirs = pruneExpandedDirs(expandedDirs, oldPath);
  }

  patchFilePanelState({ expandedDirs, selectedPath });
}

/** Align viewer tabs with deleted, renamed, or moved paths. */
export function syncViewerAfterPathChange(
  oldPath: string | null,
  newPath: string | null,
  operation: FileTreeMutationOp,
): void {
  void (async () => {
    if (!oldPath) return;
    const viewer = await import('./file-viewer');
    const tabStore = await import('./file-viewer-tab-store');
    const oldNorm = normalizeTreePath(oldPath);

    if (operation === 'delete') {
      tabStore.closeViewerTabsUnderAncestor(oldNorm);
      if (tabStore.listViewerTabs().length === 0) {
        viewer.closeFileViewerForce();
      } else {
        viewer.renderActiveViewerTab();
      }
      return;
    }

    if (!newPath) return;
    const newNorm = normalizeTreePath(newPath);
    tabStore.remapViewerTabsUnderAncestor(oldNorm, newNorm);
    viewer.renderActiveViewerTab();
  })();
}

async function finishMutation(
  oldPath: string | null,
  newPath: string | null,
  operation: FileTreeMutationOp,
): Promise<void> {
  applyPathChangeToFilePanelState(oldPath, newPath);
  syncViewerAfterPathChange(oldPath, newPath, operation);
  await refreshFileTreeViaBridge();
}

async function confirmRenameIfDirty(path: string): Promise<boolean> {
  const tabStore = await import('./file-viewer-tab-store');
  const norm = normalizeTreePath(path);
  if (tabStore.isViewerTabDirty(norm)) {
    return await appConfirm(
      'This file has unsaved changes. Rename anyway? The editor will follow the new path.',
    );
  }
  return true;
}

async function confirmDelete(path: string, kind: FileTreeEntryKind): Promise<boolean> {
  const tabStore = await import('./file-viewer-tab-store');
  const norm = normalizeTreePath(path);
  if (tabStore.isViewerTabDirty(norm)) {
    const ok = await appConfirm(
      'This file has unsaved changes. Delete anyway? Changes will be lost.',
    );
    if (!ok) return false;
  }
  if (kind === 'dir') {
    return await appConfirm(
      `Delete folder "${basename(path)}" and everything inside it? This cannot be undone.`,
    );
  }
  return await appConfirm(`Delete "${basename(path)}"?`);
}

/** Delete a file or directory via delete_path. */
export async function deletePath(path: string, kind: FileTreeEntryKind): Promise<boolean> {
  if (!(await confirmDelete(path, kind))) return false;
  setStatus('spin', 'Deleting…');
  const result = await runFileTreeTool('delete_path', { path: normalizeTreePath(path) });
  if (!result.ok) return false;
  await finishMutation(path, null, 'delete');
  return true;
}

/** Start inline rename on the matching tree row (context menu / F2). */
export function renamePath(path: string, kind: FileTreeEntryKind): void {
  void import('./file-tree-rename').then((m) => m.startInlineRename(path, kind));
}

/** Apply rename after inline edit (or tests) via move_file. */
export async function commitRename(
  path: string,
  kind: FileTreeEntryKind,
  nextName: string,
): Promise<boolean> {
  const currentName = basename(path);
  const trimmed = nextName.trim();
  if (!trimmed) {
    setStatus('err', 'Name cannot be empty.');
    return false;
  }
  if (!isValidEntryName(trimmed)) {
    setStatus('err', 'Invalid name. Use a single name without / or \\.');
    return false;
  }
  if (trimmed === currentName) {
    setStatus('idle', 'Name unchanged');
    return false;
  }
  if (!(await confirmRenameIfDirty(path))) {
    setStatus('idle', 'Rename cancelled');
    return false;
  }

  const parent = dirname(path);
  const destination = joinTreePath(parent, trimmed);
  return movePath(path, destination, 'rename');
}

/** Move or rename with move_file. */
export async function movePath(
  source: string,
  destination: string,
  operation: 'rename' | 'move' = 'move',
): Promise<boolean> {
  setStatus('spin', operation === 'rename' ? 'Renaming…' : 'Moving…');
  const result = await runFileTreeTool('move_file', {
    source: normalizeTreePath(source),
    destination: normalizeTreePath(destination),
  });
  if (!result.ok) return false;
  await finishMutation(source, destination, operation);
  return true;
}

/** Copy or cut clipboard item into target directory. */
export async function pasteInto(targetDir: string): Promise<boolean> {
  const clip = getFileTreeClipboard();
  if (!clip || clip.paths.length === 0) {
    setStatus('err', 'Nothing to paste. Copy or cut a file first.');
    return false;
  }

  const dir = normalizeTreePath(targetDir === '.' ? '.' : targetDir);
  const source = clip.paths[0];
  const dest = joinTreePath(dir, basename(source));
  const toolName = clip.mode === 'cut' ? 'move_file' : 'copy_file';
  const op: FileTreeMutationOp = clip.mode === 'cut' ? 'move' : 'create';

  setStatus('spin', clip.mode === 'cut' ? 'Moving…' : 'Copying…');
  const result = await runFileTreeTool(toolName, {
    source: normalizeTreePath(source),
    destination: normalizeTreePath(dest),
  });
  if (!result.ok) return false;

  if (clip.mode === 'cut') {
    clearFileTreeClipboard();
    await finishMutation(source, dest, op);
  } else {
    await finishMutation(null, null, 'create');
  }
  return true;
}

/** Open inline name field for a new file under parentDir (context menu). */
export function createFileInDir(parentDir: string): void {
  void import('./file-tree-create').then((m) => m.startInlineCreate(parentDir, 'file'));
}

/** Open inline name field for a new folder under parentDir (context menu). */
export function createFolderInDir(parentDir: string): void {
  void import('./file-tree-create').then((m) => m.startInlineCreate(parentDir, 'dir'));
}

/** Create file or folder after inline name entry. */
export async function commitCreate(
  parentDir: string,
  kind: FileTreeEntryKind,
  name: string,
): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) {
    setStatus('err', 'Name cannot be empty.');
    return false;
  }
  if (!isValidEntryName(trimmed)) {
    setStatus('err', 'Invalid name. Use a single name without / or \\.');
    return false;
  }
  const path = joinTreePath(parentDir, trimmed);
  setStatus('spin', kind === 'dir' ? 'Creating folder…' : 'Creating file…');
  const result = await runFileTreeTool(
    kind === 'dir' ? 'make_directory' : 'save_file',
    kind === 'dir' ? { path } : { path, content: '' },
  );
  if (!result.ok) return false;
  await finishMutation(null, null, 'create');
  return true;
}

/** Copy path to in-memory clipboard. */
export function copyPathToClipboard(path: string): void {
  setFileTreeClipboard('copy', [normalizeTreePath(path)]);
  setStatus('ok', `Copied ${basename(path)}`);
}

/** Cut path to in-memory clipboard. */
export function cutPathToClipboard(path: string): void {
  setFileTreeClipboard('cut', [normalizeTreePath(path)]);
  setStatus('ok', `Cut ${basename(path)}`);
}

export { pasteTargetDirForPath } from './file-tree-path';
