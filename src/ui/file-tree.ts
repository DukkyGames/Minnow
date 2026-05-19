/**
 * Project file tree — lazy list_directory via executeTool.
 */

import { parseListDirectoryResult, type ParsedListing } from '../lib/list-directory-parse';
import { executeTool, getLocalServerAvailable } from '../tools/client';
import { getFilePanelState, patchFilePanelState } from '../state/file-panel';
import { openFileInViewer } from './file-viewer';

const listingCache = new Map<string, ParsedListing>();
const loadingDirs = new Set<string>();

function joinPath(parent: string, name: string): string {
  if (parent === '.' || parent === '') return name;
  return `${parent}/${name}`;
}

function isExpanded(path: string): boolean {
  return getFilePanelState().expandedDirs.includes(path);
}

async function fetchListing(relativePath: string): Promise<ParsedListing | { error: string }> {
  const cached = listingCache.get(relativePath);
  if (cached) return cached;

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
}

export async function expandDir(path: string): Promise<void> {
  if (!getLocalServerAvailable()) return;
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
  const fullPath = joinPath(parentPath, name);
  const expanded = isExpanded(fullPath);
  const loading = loadingDirs.has(fullPath);

  const row = document.createElement('div');
  row.className = 'file-tree-row file-tree-row--dir';
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.tabIndex = 0;

  row.appendChild(createExpandHit(fullPath, expanded));

  const label = document.createElement('span');
  label.className = 'file-tree-label';
  label.textContent = loading ? `${name} …` : name;
  row.appendChild(label);

  row.addEventListener('click', () => {
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
  const fullPath = joinPath(parentPath, name);
  const selected = getFilePanelState().selectedPath === fullPath;

  const row = document.createElement('div');
  row.className = 'file-tree-row file-tree-row--file' + (selected ? ' selected' : '');
  row.setAttribute('role', 'treeitem');
  row.style.paddingLeft = `${22 + depth * 14}px`;
  row.tabIndex = 0;

  const label = document.createElement('span');
  label.className = 'file-tree-label';
  label.textContent = name;
  row.appendChild(label);

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    void openFileInViewer(fullPath);
  });
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void openFileInViewer(fullPath);
    }
  });

  host.appendChild(row);
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

  if (!getLocalServerAvailable()) {
    renderOfflineEmpty(host);
    return;
  }

  const root = getFilePanelState().treeRoot || '.';
  const rootListing = listingCache.get(root);

  if (!rootListing) {
    host.innerHTML = '';
    const wait = document.createElement('p');
    wait.className = 'file-tree-loading';
    wait.textContent = loadingDirs.has(root) ? 'Loading project…' : 'Open Files to load tree';
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
  if (!getLocalServerAvailable()) {
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
  if (!getLocalServerAvailable()) {
    renderFileTree();
    return;
  }
  if (listingCache.size === 0) {
    await refreshFileTree();
  } else {
    renderFileTree();
  }
}
