/**
 * Brain graph home: tree panel, force canvas, toolbar, and inspector sync.
 */

import { fetchBrainTree } from '../../brain/client';
import type { BrainPageMeta } from '../../brain/types';
import { flattenBrainTree } from './tree-utils';
import { buildPageGraph, filterGraphByQuery } from './graph/graph-data';
import { createForceGraph, type ForceGraphApi } from './graph/force-graph';
import type { GraphNode } from './graph/types';
import { closeBrainInspector, renderBrainInspector } from './inspector';

let selectedPath: string | null = null;
let catalogPages: BrainPageMeta[] = [];
let graphApi: ForceGraphApi | null = null;
let includeTags = true;
let layoutMode: 'graph' | 'tree' = 'graph';
let highlightOrphans = false;
let orphanPaths = new Set<string>();
let searchQuery = '';
let bindingsDone = false;
let firstRunHint = true;

/**
 * Lightweight selection path: reuses the existing simulation instead of rebuilding.
 * Falls back to a full `renderGraphSection()` when the graph is not yet mounted
 * or the page is not in the current catalog (e.g. navigating from Edit after a save).
 */
function selectGraphPage(relPath: string): void {
  const inCatalog = catalogPages.some((p) => p.path === relPath);
  if (!graphApi || !inCatalog) {
    selectedPath = relPath;
    void renderGraphSection();
    return;
  }
  selectedPath = relPath;
  const nodeId = `page:${relPath}`;
  graphApi.selectNode(nodeId);
  graphApi.centerOnNode(nodeId);
  syncTreeSelection();
  void openInspector(relPath);
}

/** Open a page from graph, tree, wikilinks, or lint. */
export function navigateBrainGraphPage(relPath: string): void {
  selectGraphPage(relPath.replace(/\\/g, '/'));
}

export function getGraphSelectedPath(): string | null {
  return selectedPath;
}

export function setGraphSelectedPath(relPath: string | null): void {
  selectedPath = relPath;
}

/** Highlight orphan pages from lint. Called just before openBrain('graph'), so the
 * navigation that follows will call renderGraphSection() and apply the updated state. */
export function setGraphOrphanPaths(paths: string[]): void {
  orphanPaths = new Set(paths);
  highlightOrphans = paths.length > 0;
  // Sync the toolbar toggle so the user can see and clear the highlight on arrival.
  const btn = document.getElementById('brainGraphOrphanToggle');
  if (btn) btn.setAttribute('aria-pressed', highlightOrphans ? 'true' : 'false');
}

function bindGraphToolbar(): void {
  if (bindingsDone) return;
  bindingsDone = true;

  document.getElementById('brainGraphNewPage')?.addEventListener('click', () => {
    void import('../brain-page').then((m) => m.openBrainNewPage());
  });

  document.getElementById('brainGraphFit')?.addEventListener('click', () => {
    graphApi?.fitToView();
  });

  document.getElementById('brainGraphZoomIn')?.addEventListener('click', () => {
    graphApi?.zoomBy(1.2);
  });

  document.getElementById('brainGraphZoomOut')?.addEventListener('click', () => {
    graphApi?.zoomBy(1 / 1.2);
  });

  document.getElementById('brainGraphLayoutToggle')?.addEventListener('click', () => {
    layoutMode = layoutMode === 'graph' ? 'tree' : 'graph';
    const btn = document.getElementById('brainGraphLayoutToggle');
    if (btn) {
      btn.textContent = layoutMode === 'graph' ? 'Tree' : 'Graph';
      btn.setAttribute('aria-pressed', layoutMode === 'tree' ? 'true' : 'false');
    }
    syncLayoutVisibility();
  });

  document.getElementById('brainGraphTagToggle')?.addEventListener('click', () => {
    includeTags = !includeTags;
    const btn = document.getElementById('brainGraphTagToggle');
    btn?.setAttribute('aria-pressed', includeTags ? 'true' : 'false');
    void refreshGraphCanvas();
  });

  document.getElementById('brainGraphOrphanToggle')?.addEventListener('click', () => {
    highlightOrphans = !highlightOrphans;
    const btn = document.getElementById('brainGraphOrphanToggle');
    btn?.setAttribute('aria-pressed', highlightOrphans ? 'true' : 'false');
    void refreshGraphCanvas();
  });

  // Bind the first-run hint dismiss button once here so it never re-attaches.
  document.getElementById('brainGraphDismissHint')?.addEventListener('click', () => {
    const hint = document.getElementById('brainGraphFirstRun');
    if (hint) hint.classList.add('hidden');
    firstRunHint = false;
  });

  const searchEl = document.getElementById('brainGraphSearch') as HTMLInputElement | null;
  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    void refreshGraphCanvas();
  });

  const treeToggle = document.getElementById('brainGraphTreeToggle');
  treeToggle?.addEventListener('click', () => {
    const panel = document.getElementById('brainGraphTreePanel');
    const collapsed = panel?.classList.toggle('is-collapsed');
    treeToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
}

function syncLayoutVisibility(): void {
  const canvasWrap = document.getElementById('brainGraphCanvasWrap');
  const treeOnly = document.getElementById('brainGraphTreeOnly');
  canvasWrap?.classList.toggle('hidden', layoutMode === 'tree');
  treeOnly?.classList.toggle('hidden', layoutMode !== 'tree');
}

async function refreshGraphCanvas(): Promise<void> {
  const canvas = document.getElementById('brainGraphCanvas') as HTMLCanvasElement | null;
  const statsEl = document.getElementById('brainGraphStats');
  const denseEl = document.getElementById('brainGraphDenseNote');
  if (!canvas) return;

  if (!graphApi) {
    graphApi = createForceGraph(canvas, {
      onSelect: (node) => {
        if (!node?.path) return;
        selectedPath = node.path;
        syncTreeSelection();
        void openInspector(node.path);
      },
      onDoubleClick: (node) => {
        if (!node?.path) return;
        // Focus-subtree: zoom to the node's neighborhood and make the highlight sticky.
        graphApi?.focusNode(node.id);
        selectedPath = node.path;
        syncTreeSelection();
        void openInspector(node.path);
      },
      onHover: (node) => {
        graphApi?.setHoverNode(node?.id ?? null);
      },
    });
    // Resize is handled internally by the engine's ResizeObserver — no window listener needed.
  }

  let data = buildPageGraph(catalogPages, {
    includeTags,
    orphanPaths: highlightOrphans ? orphanPaths : undefined,
  });
  if (searchQuery.trim()) data = filterGraphByQuery(data, searchQuery);

  graphApi.setData(data.nodes, data.edges);
  if (statsEl) {
    statsEl.textContent = `${data.nodes.length} nodes · ${data.edges.length} edges`;
  }
  denseEl?.classList.toggle('hidden', !data.truncated);

  if (selectedPath) {
    const nodeId = `page:${selectedPath}`;
    graphApi.selectNode(nodeId);
    syncTreeSelection();
  }
  // Auto-fit is driven by the engine's pendingFit / simulation 'end' handler — no RAF needed.
}
async function openInspector(relPath: string): Promise<void> {
  const inspector = document.getElementById('brainInspector');
  if (!inspector) return;
  await renderBrainInspector(
    inspector,
    relPath,
    catalogPages,
    navigateBrainGraphPage,
    (path) => {
      void import('../brain-page').then((m) => m.openBrainEditForPath(path));
    },
  );
}

function renderGraphTree(mount: HTMLElement, tree: Record<string, unknown>): void {
  mount.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'brain-tree';
  list.setAttribute('role', 'tree');

  const appendNodes = (parent: HTMLElement, node: Record<string, unknown>): void => {
    const entries = Object.entries(node).sort(([a], [b]) => a.localeCompare(b));
    for (const [name, value] of entries) {
      if (!value || typeof value !== 'object') continue;
      const item = document.createElement('li');
      item.className = 'brain-tree__item';
      const record = value as Record<string, unknown>;

      if (record.type === 'page') {
        const path = String(record.path ?? '');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'brain-tree__page';
        btn.dataset.path = path;
        btn.textContent = String(record.title ?? name);
        btn.setAttribute('role', 'treeitem');
        btn.setAttribute('aria-current', path === selectedPath ? 'page' : 'false');
        btn.addEventListener('click', () => {
          navigateBrainGraphPage(path);
        });
        item.append(btn);
        parent.append(item);
        continue;
      }

      if (record.type === 'folder') {
        const folderBtn = document.createElement('button');
        folderBtn.type = 'button';
        folderBtn.className = 'brain-tree__folder';
        folderBtn.textContent = name;
        folderBtn.setAttribute('aria-expanded', 'true');
        const childList = document.createElement('ul');
        childList.className = 'brain-tree__children';
        const children = record.children as Record<string, unknown> | undefined;
        if (children) appendNodes(childList, children);
        folderBtn.addEventListener('click', () => {
          const open = childList.hidden;
          childList.hidden = !open;
          folderBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        item.append(folderBtn, childList);
        parent.append(item);
      }
    }
  };

  appendNodes(list, tree);
  mount.append(list);
}

function syncTreeSelection(): void {
  document.querySelectorAll('.brain-tree__page').forEach((btn) => {
    const path = (btn as HTMLButtonElement).dataset.path ?? '';
    btn.setAttribute('aria-current', path === selectedPath ? 'page' : 'false');
  });
}

function showFirstRunHint(): void {
  const hint = document.getElementById('brainGraphFirstRun');
  if (!hint || !firstRunHint) return;
  if (catalogPages.length > 1) {
    hint.classList.add('hidden');
    firstRunHint = false;
    return;
  }
  hint.classList.remove('hidden');
  // Dismiss button is wired once in bindGraphToolbar().
}

/** Render graph home section. */
export async function renderGraphSection(): Promise<void> {
  bindGraphToolbar();

  const treeMount = document.getElementById('brainGraphTree');
  const treeOnlyMount = document.getElementById('brainGraphTreeOnly');
  const offlineEl = document.getElementById('brainGraphOffline');
  const emptyEl = document.getElementById('brainGraphEmpty');
  const stageEl = document.getElementById('brainGraphStage');
  if (!treeMount || !stageEl) return;

  const tree = await fetchBrainTree();
  const online = tree !== null;
  offlineEl?.classList.toggle('hidden', online);
  stageEl.classList.toggle('is-offline', !online);

  if (!online) {
    treeMount.replaceChildren();
    treeOnlyMount?.replaceChildren();
    graphApi?.destroy();
    graphApi = null;
    emptyEl?.classList.add('hidden');
    return;
  }

  catalogPages = flattenBrainTree(tree);
  const treeRecord = tree as unknown as Record<string, unknown>;
  renderGraphTree(treeMount, treeRecord);
  if (treeOnlyMount) renderGraphTree(treeOnlyMount, treeRecord);

  const hasPages = catalogPages.length > 0;
  emptyEl?.classList.toggle('hidden', hasPages);
  stageEl.classList.toggle('is-empty', !hasPages);

  if (!hasPages) {
    graphApi?.destroy();
    graphApi = null;
    return;
  }

  const initial =
    selectedPath ??
    catalogPages.find((p) => p.path === 'index.md')?.path ??
    catalogPages[0]?.path ??
    null;
  if (initial) {
    selectedPath = initial;
    await openInspector(initial);
  } else {
    const inspector = document.getElementById('brainInspector');
    if (inspector) closeBrainInspector(inspector);
  }

  await refreshGraphCanvas();
  syncLayoutVisibility();
  showFirstRunHint();
}

