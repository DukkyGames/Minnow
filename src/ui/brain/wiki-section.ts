/**
 * Brain app — Wiki section: tree + rendered page viewer with wikilinks and backlinks.
 */

import { fetchBrainPage, fetchBrainTree } from '../../brain/client';
import type { BrainPageMeta } from '../../brain/types';
import { computeBrainBacklinks, flattenBrainTree } from './tree-utils';
import { renderBrainMarkdown } from './wikilink-markdown';

let selectedPath: string | null = null;
let catalogPages: BrainPageMeta[] = [];

export type WikiNavigateFn = (relPath: string) => void;

/** Open a page in the wiki viewer (used by wikilinks and tree). */
export function navigateBrainWikiPage(relPath: string): void {
  selectedPath = relPath.replace(/\\/g, '/');
  void renderWikiSection();
}

/** Render the wiki tree and active page viewer. */
export async function renderWikiSection(): Promise<void> {
  const treeMount = document.getElementById('brainWikiTree');
  const viewerMount = document.getElementById('brainWikiViewer');
  const offlineEl = document.getElementById('brainWikiOffline');
  if (!treeMount || !viewerMount) return;

  const tree = await fetchBrainTree();
  const online = tree !== null;
  offlineEl?.classList.toggle('hidden', online);

  if (!online) {
    treeMount.replaceChildren();
    viewerMount.replaceChildren();
    const note = document.createElement('p');
    note.className = 'brain-muted';
    note.textContent = 'Start npm start to browse the wiki.';
    viewerMount.append(note);
    return;
  }

  catalogPages = flattenBrainTree(tree);
  renderWikiTree(treeMount, tree as unknown as Record<string, unknown>);

  const initial =
    selectedPath ??
    catalogPages.find((p) => p.path === 'index.md')?.path ??
    catalogPages[0]?.path ??
    null;
  if (initial) {
    await renderWikiPage(viewerMount, initial);
  } else {
    viewerMount.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'brain-muted';
    empty.textContent = 'No wiki pages yet. Create one in Edit or run Ingest.';
    viewerMount.append(empty);
  }
}

function renderWikiTree(
  mount: HTMLElement,
  tree: Record<string, unknown>,
): void {
  mount.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'brain-wiki-tree';
  list.setAttribute('role', 'tree');

  const appendNodes = (
    parent: HTMLElement,
    node: Record<string, unknown>,
    prefix = '',
  ): void => {
    const entries = Object.entries(node).sort(([a], [b]) => a.localeCompare(b));
    for (const [name, value] of entries) {
      if (!value || typeof value !== 'object') continue;
      const item = document.createElement('li');
      item.className = 'brain-wiki-tree__item';
      const record = value as Record<string, unknown>;

      if (record.type === 'page') {
        const path = String(record.path ?? '');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'brain-wiki-tree__page';
        btn.dataset.path = path;
        btn.textContent = String(record.title ?? name);
        btn.setAttribute('role', 'treeitem');
        btn.setAttribute('aria-current', path === selectedPath ? 'page' : 'false');
        btn.addEventListener('click', () => navigateBrainWikiPage(path));
        item.append(btn);
        parent.append(item);
        continue;
      }

      if (record.type === 'folder') {
        const folderLabel = document.createElement('span');
        folderLabel.className = 'brain-wiki-tree__folder';
        folderLabel.textContent = name;
        item.append(folderLabel);
        const childList = document.createElement('ul');
        childList.className = 'brain-wiki-tree__children';
        const children = record.children as Record<string, unknown> | undefined;
        if (children) appendNodes(childList, children, `${prefix}${name}/`);
        item.append(childList);
        parent.append(item);
      }
    }
  };

  appendNodes(list, tree);
  mount.append(list);
}

async function renderWikiPage(mount: HTMLElement, relPath: string): Promise<void> {
  selectedPath = relPath;
  document.querySelectorAll('.brain-wiki-tree__page').forEach((btn) => {
    const path = (btn as HTMLButtonElement).dataset.path ?? '';
    btn.setAttribute('aria-current', path === relPath ? 'page' : 'false');
  });

  const page = await fetchBrainPage(relPath);
  mount.replaceChildren();

  if (!page) {
    const err = document.createElement('p');
    err.className = 'brain-error';
    err.textContent = `Could not load ${relPath}.`;
    mount.append(err);
    return;
  }

  const head = document.createElement('header');
  head.className = 'brain-wiki-viewer__head';
  const title = document.createElement('h3');
  title.className = 'brain-wiki-viewer__title';
  title.textContent = page.meta.title;
  const pathLine = document.createElement('p');
  pathLine.className = 'brain-wiki-viewer__path';
  pathLine.textContent = page.path;
  head.append(title, pathLine);

  if (page.meta.tags?.length) {
    const tags = document.createElement('p');
    tags.className = 'brain-wiki-viewer__tags';
    tags.textContent = page.meta.tags.join(' · ');
    head.append(tags);
  }

  const body = document.createElement('div');
  body.className = 'brain-wiki-viewer__body';
  renderBrainMarkdown(body, page.body, navigateBrainWikiPage);

  const backlinks = computeBrainBacklinks(catalogPages, page.path);
  const backSection = document.createElement('section');
  backSection.className = 'brain-wiki-backlinks';
  const backTitle = document.createElement('h4');
  backTitle.className = 'brain-section-subtitle';
  backTitle.textContent = 'Backlinks';
  backSection.append(backTitle);

  if (!backlinks.length) {
    const none = document.createElement('p');
    none.className = 'brain-muted';
    none.textContent = 'No pages link here yet.';
    backSection.append(none);
  } else {
    const list = document.createElement('ul');
    list.className = 'brain-wiki-backlinks__list';
    for (const from of backlinks) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brain-inline-link';
      btn.textContent = from;
      btn.addEventListener('click', () => navigateBrainWikiPage(from));
      li.append(btn);
      list.append(li);
    }
    backSection.append(list);
  }

  const editRow = document.createElement('div');
  editRow.className = 'brain-wiki-viewer__actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'brain-action-btn';
  editBtn.textContent = 'Edit page';
  editBtn.addEventListener('click', () => {
    void import('../brain-page').then((m) => {
      m.openBrainEditForPath(page.path);
    });
  });
  editRow.append(editBtn);

  mount.append(head, body, backSection, editRow);
}

/** Seed edit section when jumping from wiki. */
export function getWikiSelectedPath(): string | null {
  return selectedPath;
}

export function setWikiSelectedPath(relPath: string | null): void {
  selectedPath = relPath;
}
