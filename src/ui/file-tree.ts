/**
 * Project file tree — lazy list_directory via executeTool; CRUD via file-tree-ops.
 */

import { WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import { parseListDirectoryResult, type ParsedListing } from '../lib/list-directory-parse';
import { getFilePanelState, patchFilePanelState } from '../state/file-panel';
import { isFileTreeServerAvailable } from './file-tree-server';
import {
  basenameOf,
  ensureWorkspaceIndex,
  filterPaths,
  getFilterQuery,
  invalidateFileTreeIndex,
  sortFilteredPaths,
} from './file-tree-filter';
import { joinTreePath } from './file-tree-path';
import {
  buildMenuContext,
  hideFileTreeContextMenu,
  showFileTreeBackgroundContextMenu,
  showFileTreeRowContextMenu,
} from './file-tree-context-menu';
import { getFileTreeClipboard } from './file-tree-clipboard';
import { pasteTargetDirForPath } from './file-tree-path';
type FileTreeEntryKind = 'file' | 'dir';
import {
  dirRowPaddingLeftPx,
  FILE_TREE_DIR_BASE_PADDING_PX,
  fileRowPaddingLeftPx,
} from './file-tree-indent';
import { isFileViewerEditorFocused } from './file-viewer-focus';
import * as fileTreeOps from './file-tree-ops';

export {
  FILE_TREE_DEPTH_INDENT_PX,
  FILE_TREE_DIR_BASE_PADDING_PX,
  FILE_TREE_FILE_BASE_PADDING_PX,
} from './file-tree-indent';

const listingCache = new Map<string, ParsedListing>();
const loadingDirs = new Set<string>();

let crudBound = false;
let focusedTreePath: string | null = null;
let focusedTreeKind: FileTreeEntryKind | null = null;

function isExpanded(path: string): boolean {
  return getFilePanelState().expandedDirs.includes(path);
}

async function fetchListing(relativePath: string): Promise<ParsedListing | { error: string }> {
  const cached = listingCache.get(relativePath);
  if (cached) return cached;

  const { executeTool } = await import('../tools/client');
  const raw = (await executeTool('list_directory', { path: relativePath })).content;
  const parsed = parseListDirectoryResult(raw);
  if ('error' in parsed) {
    return parsed;
  }
  listingCache.set(relativePath, parsed);
  return parsed;
}

function setExpanded(path: string, open: boolean): void {
  const state = getFilePanelState();
  let next = [...state.expandedDirs];
  if (open && !next.includes(path)) {
    next.push(path);
  } else if (!open) {
    next = next.filter((p) => p !== path);
  }
  patchFilePanelState({ expandedDirs: next });
}

export function invalidateFileTreeCache(): void {
  listingCache.clear();
  invalidateFileTreeIndex();
}

let filterRenderGeneration = 0;

export async function expandDir(path: string): Promise<void> {
  if (!isFileTreeServerAvailable()) return;
  setExpanded(path, true);
  loadingDirs.add(path);
  renderFileTree();
  await fetchListing(path);
  loadingDirs.delete(path);
  renderFileTree();
}

export function collapseDir(path: string): void {
  setExpanded(path, false);
  renderFileTree();
}

function setFocusedRow(path: string, kind: FileTreeEntryKind, row: HTMLElement): void {
  focusedTreePath = path;
  focusedTreeKind = kind;
  document.querySelectorAll('.file-tree-row--focused').forEach((el) => {
    el.classList.remove('file-tree-row--focused');
  });
  row.classList.add('file-tree-row--focused');
}

/**
 * Draggable file-tree row (composer copy + internal move).
 * Click-vs-drag uses the browser drag threshold; suppressClick avoids opening the
 * viewer after a completed drag.
 */
function wireTreeRowDrag(row: HTMLElement, fullPath: string): { consumeClickAfterDrag: () => boolean } {
  row.draggable = true;
  let suppressClick = false;

  row.addEventListener('mousedown', () => {
    suppressClick = false;
  });

  row.addEventListener('dragstart', (event) => {
    suppressClick = true;
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.effectAllowed = 'copyMove';
    transfer.setData(WORKSPACE_FILE_MIME, fullPath);
    transfer.setData('text/plain', fullPath);
  });

  row.addEventListener('dragend', () => {
    suppressClick = true;
  });

  return {
    consumeClickAfterDrag: () => {
      if (!suppressClick) return false;
      suppressClick = false;
      return true;
    },
  };
}

function wireRowContextMenu(
  row: HTMLElement,
  path: string,
  kind: FileTreeEntryKind,
): void {
  row.dataset.path = path;
  row.dataset.entryKind = kind;

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFocusedRow(path, kind, row);
    showFileTreeRowContextMenu(buildMenuContext(path, kind), e.clientX, e.clientY);
  });

  row.addEventListener('focus', () => setFocusedRow(path, kind, row));
}

function renderOfflineEmpty(host: HTMLElement): void {
  host.innerHTML = '';
  const msg = document.createElement('p');
  msg.className = 'file-tree-empty';
  msg.textContent = 'Start with npm start to browse project files.';
  host.appendChild(msg);
}

function renderTreeError(host: HTMLElement, message: string): void {
  host.innerHTML = '';
  const msg = document.createElement('p');
  msg.className = 'file-tree-empty file-tree-error';
  msg.textContent = message;
  host.appendChild(msg);
}

function createExpandHit(path: string, expanded: boolean): HTMLSpanElement {
  const hit = document.createElement('span');
  hit.className = 'file-tree-expand' + (expanded ? ' open' : '');
  hit.setAttribute('role', 'presentation');
  hit.tabIndex = 0;
  hit.setAttribute('aria-label', expanded ? `Collapse ${path}` : `Expand ${path}`);
  hit.addEventListener('click', (e) => {
    e.stopPropagation();
    if (expanded) collapseDir(path);
    else void expandDir(path);
  });
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (expanded) collapseDir(path);
      else void expandDir(path);
    }
  });
  return hit;
}

function appendDirRow(
  host: HTMLElement,
  parentPath: string,
  name: string,
  depth: number,
): void {
  const fullPath = joinTreePath(parentPath, name);
  const expanded = isExpanded(fullPath);
  const loading = loadingDirs.has(fullPath);

  const row = document.createElement('div');
  row.className = 'file-tree-row file-tree-row--dir';
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  row.style.paddingLeft = `${dirRowPaddingLeftPx(depth)}px`;
  row.tabIndex = 0;

  row.appendChild(createExpandHit(fullPath, expanded));

  const label = document.createElement('span');
  label.className = 'file-tree-label';
  label.textContent = loading ? `${name} …` : name;
  row.appendChild(label);

  const drag = wireTreeRowDrag(row, fullPath);

  row.addEventListener('click', () => {
    if (drag.consumeClickAfterDrag()) return;
    setFocusedRow(fullPath, 'dir', row);
    if (expanded) collapseDir(fullPath);
    else void expandDir(fullPath);
  });
  row.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (!expanded) void expandDir(fullPath);
  });
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (expanded) collapseDir(fullPath);
      else void expandDir(fullPath);
    }
  });

  wireRowContextMenu(row, fullPath, 'dir');
  host.appendChild(row);

  if (expanded) {
    const group = document.createElement('div');
    group.className = 'file-tree-children';
    group.setAttribute('role', 'group');
    host.appendChild(group);
    renderSubtree(group, fullPath, depth + 1);
  }
}

function appendFileRow(
  host: HTMLElement,
  parentPath: string,
  name: string,
  depth: number,
): void {
  const fullPath = joinTreePath(parentPath, name);
  const selected = getFilePanelState().selectedPath === fullPath;

  const row = document.createElement('div');
  row.className = 'file-tree-row file-tree-row--file' + (selected ? ' selected' : '');
  row.setAttribute('role', 'treeitem');
  row.style.paddingLeft = `${fileRowPaddingLeftPx(depth)}px`;
  row.tabIndex = 0;

  const label = document.createElement('span');
  label.className = 'file-tree-label';
  label.textContent = name;
  row.appendChild(label);

  const drag = wireTreeRowDrag(row, fullPath);

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    setFocusedRow(fullPath, 'file', row);
    if (drag.consumeClickAfterDrag()) return;
    void import('./file-viewer').then((m) => m.openFileInViewer(fullPath));
  });
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void import('./file-viewer').then((m) => m.openFileInViewer(fullPath));
    }
  });

  wireRowContextMenu(row, fullPath, 'file');
  host.appendChild(row);
}

function appendFlatFileRow(host: HTMLElement, fullPath: string): void {
  const selected = getFilePanelState().selectedPath === fullPath;
  const base = basenameOf(fullPath);
  const parent =
    fullPath.includes('/') ? fullPath.slice(0, fullPath.length - base.length - 1) : '';

  const row = document.createElement('div');
  row.className =
    'file-tree-row file-tree-row--file file-tree-row--flat' + (selected ? ' selected' : '');
  row.setAttribute('role', 'option');
  row.style.paddingLeft = `${FILE_TREE_DIR_BASE_PADDING_PX}px`;
  row.tabIndex = 0;

  const label = document.createElement('span');
  label.className = 'file-tree-label file-tree-label--flat';
  if (parent) {
    const parentSpan = document.createElement('span');
    parentSpan.className = 'file-tree-path-parent';
    parentSpan.textContent = `${parent}/`;
    const baseSpan = document.createElement('span');
    baseSpan.className = 'file-tree-path-base';
    baseSpan.textContent = base;
    label.appendChild(parentSpan);
    label.appendChild(baseSpan);
  } else {
    label.textContent = base;
  }
  row.appendChild(label);

  const drag = wireTreeRowDrag(row, fullPath);

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    setFocusedRow(fullPath, 'file', row);
    if (drag.consumeClickAfterDrag()) return;
    void import('./file-viewer').then((m) => m.openFileInViewer(fullPath));
  });
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void import('./file-viewer').then((m) => m.openFileInViewer(fullPath));
    }
  });

  wireRowContextMenu(row, fullPath, 'file');
  host.appendChild(row);
}

async function renderFlatResults(host: HTMLElement, root: string, query: string): Promise<void> {
  const generation = ++filterRenderGeneration;
  host.innerHTML = '';
  host.setAttribute('role', 'listbox');
  host.setAttribute('aria-label', 'Filtered project files');

  const wait = document.createElement('p');
  wait.className = 'file-tree-loading';
  wait.textContent = 'Indexing project…';
  host.appendChild(wait);

  const indexResult = await ensureWorkspaceIndex(root, fetchListing);
  if (generation !== filterRenderGeneration) return;

  host.innerHTML = '';
  host.setAttribute('role', 'listbox');
  host.setAttribute('aria-label', 'Filtered project files');

  if ('error' in indexResult) {
    renderTreeError(host, indexResult.error);
    return;
  }

  const matched = sortFilteredPaths(filterPaths(indexResult, query), query);
  if (matched.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'file-tree-empty';
    empty.textContent = 'No matching files';
    host.appendChild(empty);
    return;
  }

  for (const filePath of matched) {
    appendFlatFileRow(host, filePath);
  }
}

function renderSubtree(host: HTMLElement, dirPath: string, depth: number): void {
  const listing = listingCache.get(dirPath);
  if (!listing) {
    if (loadingDirs.has(dirPath)) {
      const wait = document.createElement('p');
      wait.className = 'file-tree-loading';
      wait.textContent = 'Loading…';
      host.appendChild(wait);
    }
    return;
  }

  for (const dir of listing.dirs) {
    appendDirRow(host, dirPath, dir, depth);
  }
  for (const file of listing.files) {
    appendFileRow(host, dirPath, file, depth);
  }
}

export function renderFileTree(): void {
  const host = document.getElementById('fileTreeHost');
  if (!host) return;

  if (!isFileTreeServerAvailable()) {
    renderOfflineEmpty(host);
    return;
  }

  const activeFilter = getFilterQuery().trim();
  if (activeFilter) {
    const root = getFilePanelState().treeRoot || '.';
    void renderFlatResults(host, root, activeFilter);
    return;
  }

  const root = getFilePanelState().treeRoot || '.';
  const rootListing = listingCache.get(root);

  if (!rootListing) {
    host.innerHTML = '';
    host.setAttribute('role', 'tree');
    host.setAttribute('aria-label', 'Project files');
    const wait = document.createElement('p');
    wait.className = 'file-tree-loading';
    wait.textContent = 'Loading project…';
    host.appendChild(wait);
    return;
  }

  host.innerHTML = '';
  host.setAttribute('role', 'tree');
  host.setAttribute('aria-label', 'Project files');
  renderSubtree(host, root, 0);
}

export async function refreshFileTree(): Promise<void> {
  invalidateFileTreeCache();
  if (!isFileTreeServerAvailable()) {
    renderFileTree();
    return;
  }

  const root = getFilePanelState().treeRoot || '.';
  loadingDirs.add(root);
  renderFileTree();

  const rootResult = await fetchListing(root);
  loadingDirs.delete(root);

  if ('error' in rootResult) {
    const host = document.getElementById('fileTreeHost');
    if (host) renderTreeError(host, rootResult.error);
    return;
  }

  const expanded = [...getFilePanelState().expandedDirs];
  for (const dir of expanded) {
    loadingDirs.add(dir);
    await fetchListing(dir);
    loadingDirs.delete(dir);
  }

  renderFileTree();
}

export async function initFileTreeIfNeeded(): Promise<void> {
  if (!isFileTreeServerAvailable()) {
    renderFileTree();
    return;
  }
  if (listingCache.size === 0) {
    await refreshFileTree();
  } else {
    renderFileTree();
  }
}

function handleTreeKeydown(e: KeyboardEvent): void {
  if (!isFileTreeServerAvailable()) return;
  if (isFileViewerEditorFocused()) return;
  if (!focusedTreePath || !focusedTreeKind) return;

  const meta = e.metaKey;
  const ctrl = e.ctrlKey;
  const mod = meta || ctrl;

  if (mod && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    if (focusedTreeKind === 'file') fileTreeOps.copyPathToClipboard(focusedTreePath);
    return;
  }
  if (mod && (e.key === 'x' || e.key === 'X')) {
    e.preventDefault();
    fileTreeOps.cutPathToClipboard(focusedTreePath);
    return;
  }
  if (mod && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault();
    const target = pasteTargetDirForPath(focusedTreePath, focusedTreeKind);
    void fileTreeOps.pasteInto(target);
    return;
  }

  if (e.key === 'F2') {
    e.preventDefault();
    void fileTreeOps.renamePath(focusedTreePath, focusedTreeKind);
    return;
  }

  if (e.key === 'Delete') {
    e.preventDefault();
    void fileTreeOps.deletePath(focusedTreePath, focusedTreeKind);
  }
}

/** Bind tree host shortcuts and background context menu (once). */
export function initFileTreeCrud(): void {
  if (crudBound) return;
  crudBound = true;

  const host = document.getElementById('fileTreeHost');
  if (!host) return;

  host.addEventListener('keydown', handleTreeKeydown);

  host.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.file-tree-row')) return;
    if (!isFileTreeServerAvailable()) return;
    e.preventDefault();
    hideFileTreeContextMenu();
    const root = getFilePanelState().treeRoot || '.';
    showFileTreeBackgroundContextMenu(root, e.clientX, e.clientY);
  });
}

/** Test helper: current keyboard focus path in the tree. */
export function getFocusedTreePathForTests(): {
  path: string | null;
  kind: FileTreeEntryKind | null;
} {
  return { path: focusedTreePath, kind: focusedTreeKind };
}

/** Test helper: whether clipboard has items. */
export function hasFileTreeClipboardForTests(): boolean {
  return Boolean(getFileTreeClipboard()?.paths.length);
}
