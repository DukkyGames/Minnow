/**
 * Context menu for file tree rows and empty tree background.
 */

import { isFileTreeServerAvailable } from './file-tree-server';
import { getFileTreeClipboard } from './file-tree-clipboard';
import { pasteTargetDirForPath } from './file-tree-path';
type FileTreeEntryKind = 'file' | 'dir';

export interface FileTreeMenuContext {
  path: string;
  kind: FileTreeEntryKind;
  /** Directory used for New file/folder and Paste (folder path or parent of file). */
  targetDir: string;
}

let menuEl: HTMLDivElement | null = null;
let dismissBound = false;

function ensureMenuElement(): HTMLDivElement {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className = 'file-tree-context-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.hidden = true;
  document.body.appendChild(menuEl);
  return menuEl;
}

export function hideFileTreeContextMenu(): void {
  if (menuEl) menuEl.hidden = true;
}

function bindDismissOnce(): void {
  if (dismissBound) return;
  dismissBound = true;
  document.addEventListener('click', () => hideFileTreeContextMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideFileTreeContextMenu();
  });
  const host = document.getElementById('fileTreeHost');
  if (host) {
    host.addEventListener('scroll', () => hideFileTreeContextMenu(), { passive: true });
  }
}

interface MenuItemDef {
  label: string;
  action?: () => void;
  disabled?: boolean;
  title?: string;
}

function renderMenuItems(items: MenuItemDef[]): void {
  const menu = ensureMenuElement();
  menu.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'file-tree-context-menu__item';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    if (item.disabled) {
      btn.disabled = true;
      btn.classList.add('file-tree-context-menu__item--disabled');
      if (item.title) btn.title = item.title;
    } else if (item.action) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideFileTreeContextMenu();
        item.action!();
      });
    }
    menu.appendChild(btn);
  }
}

function positionMenu(clientX: number, clientY: number): void {
  const menu = ensureMenuElement();
  menu.hidden = false;
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  if (left + rect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - rect.width - margin);
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - rect.height - margin);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

async function loadOps() {
  return import('./file-tree-ops');
}

function serverCrudEnabled(): boolean {
  return isFileTreeServerAvailable();
}

function buildFileMenuItems(ctx: FileTreeMenuContext): MenuItemDef[] {
  const hasClipboard = Boolean(getFileTreeClipboard()?.paths.length);
  const offline = !serverCrudEnabled();
  const disabled = offline;
  const pasteDisabled = offline || !hasClipboard;

  return [
    {
      label: 'Open',
      disabled: offline,
      action: () => void import('./file-viewer').then((m) => m.openFileInViewer(ctx.path)),
    },
    {
      label: 'Cut',
      disabled,
      action: () => void loadOps().then((m) => m.cutPathToClipboard(ctx.path)),
    },
    {
      label: 'Copy',
      disabled,
      action: () => void loadOps().then((m) => m.copyPathToClipboard(ctx.path)),
    },
    {
      label: 'Paste',
      disabled: pasteDisabled,
      title: pasteDisabled && !hasClipboard ? 'Copy or cut a file first' : undefined,
      action: () => void loadOps().then((m) => m.pasteInto(ctx.targetDir)),
    },
    {
      label: 'Rename…',
      disabled,
      action: () => void loadOps().then((m) => m.renamePath(ctx.path, ctx.kind)),
    },
    {
      label: 'Delete',
      disabled,
      action: () => void loadOps().then((m) => m.deletePath(ctx.path, ctx.kind)),
    },
  ];
}

function buildFolderMenuItems(ctx: FileTreeMenuContext): MenuItemDef[] {
  const hasClipboard = Boolean(getFileTreeClipboard()?.paths.length);
  const offline = !serverCrudEnabled();
  const disabled = offline;
  const pasteDisabled = offline || !hasClipboard;

  return [
    {
      label: 'New File…',
      disabled,
      action: () => void loadOps().then((m) => m.createFileInDir(ctx.targetDir)),
    },
    {
      label: 'New Folder…',
      disabled,
      action: () => void loadOps().then((m) => m.createFolderInDir(ctx.targetDir)),
    },
    {
      label: 'Cut',
      disabled,
      action: () => void loadOps().then((m) => m.cutPathToClipboard(ctx.path)),
    },
    {
      label: 'Copy',
      disabled: true,
      title: 'Copy is only available for files',
    },
    {
      label: 'Paste',
      disabled: pasteDisabled,
      title: pasteDisabled && !hasClipboard ? 'Copy or cut a file first' : undefined,
      action: () => void loadOps().then((m) => m.pasteInto(ctx.targetDir)),
    },
    {
      label: 'Rename…',
      disabled,
      action: () => void loadOps().then((m) => m.renamePath(ctx.path, ctx.kind)),
    },
    {
      label: 'Delete',
      disabled,
      action: () => void loadOps().then((m) => m.deletePath(ctx.path, ctx.kind)),
    },
  ];
}

function buildBackgroundMenuItems(targetDir: string): MenuItemDef[] {
  const offline = !serverCrudEnabled();
  return [
    {
      label: 'New File…',
      disabled: offline,
      action: () => void loadOps().then((m) => m.createFileInDir(targetDir)),
    },
    {
      label: 'New Folder…',
      disabled: offline,
      action: () => void loadOps().then((m) => m.createFolderInDir(targetDir)),
    },
  ];
}

/** Show context menu for a file or folder row. */
export function showFileTreeRowContextMenu(
  ctx: FileTreeMenuContext,
  clientX: number,
  clientY: number,
): void {
  bindDismissOnce();
  const items =
    ctx.kind === 'file' ? buildFileMenuItems(ctx) : buildFolderMenuItems(ctx);
  renderMenuItems(items);
  positionMenu(clientX, clientY);
}

/** Show context menu on empty tree background (new file/folder at root). */
export function showFileTreeBackgroundContextMenu(
  targetDir: string,
  clientX: number,
  clientY: number,
): void {
  if (!serverCrudEnabled()) return;
  bindDismissOnce();
  renderMenuItems(buildBackgroundMenuItems(targetDir));
  positionMenu(clientX, clientY);
}

/** Build menu context from row path and kind. */
export function buildMenuContext(path: string, kind: FileTreeEntryKind): FileTreeMenuContext {
  return {
    path,
    kind,
    targetDir: pasteTargetDirForPath(path, kind),
  };
}
