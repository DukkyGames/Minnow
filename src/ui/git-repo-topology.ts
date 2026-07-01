/**
 * Repo topology tree: worktrees, linked worktrees, and local branches (Git Center lightbox).
 */

import {
  branchesLockedToOtherWorktrees,
  filterUserFacingBranches,
  formatWorktreeOptionLabel,
  isMinnowBoardBranch,
  parseWorktreeListPorcelain,
  type ParsedWorktree,
} from '../lib/worktree-list-parse';
import { gitBranches, gitStatus } from '../state/git-api';
import { listWorktrees } from '../state/worktree-service';
import { getWorkspacePath } from '../state/workspace';
import { panelPathsEqual } from './panel-worktree-cwd';

/** Node kinds in the topology tree. */
export type TopologyNodeKind =
  | 'root'
  | 'worktree'
  | 'local-branches-group'
  | 'branch';

/** One row in the repo topology tree. */
export interface TopologyNode {
  id: string;
  kind: TopologyNodeKind;
  label: string;
  /** Worktree path when kind is root or worktree. */
  cwd?: string;
  branch?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  detached?: boolean;
  children?: TopologyNode[];
}

export interface TopologyTreeModel {
  nodes: TopologyNode[];
  repoName: string;
  error?: string;
}

export interface TopologyRenderOptions {
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (node: TopologyNode) => void;
  onToggleExpand: (nodeId: string) => void;
  onContextMenu?: (node: TopologyNode, event: MouseEvent) => void;
  onDoubleClick?: (node: TopologyNode) => void;
}

function pathLeaf(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return norm.split('/').pop() ?? norm;
}

function isDirtyStatus(
  staged: number,
  unstaged: number,
  untracked: number,
): boolean {
  return staged + unstaged + untracked > 0;
}

/** Build topology from worktree list, branches, and per-worktree status. */
export async function buildTopologyTree(): Promise<TopologyTreeModel> {
  const ws = getWorkspacePath().trim();
  if (!ws) {
    return { nodes: [], repoName: '', error: 'No workspace open' };
  }

  const repoName = pathLeaf(ws);
  const listResult = await listWorktrees();
  let worktrees: ParsedWorktree[] = [];

  if (listResult.ok && listResult.output) {
    worktrees = parseWorktreeListPorcelain(listResult.output);
  } else {
    worktrees = [{ path: ws, head: '', branch: undefined, detached: false }];
  }

  // Filter board/orchestrator worktrees from the tree.
  worktrees = worktrees.filter((wt) => !wt.branch || !isMinnowBoardBranch(wt.branch));

  const statusByPath = new Map<
    string,
    { dirty: boolean; ahead: number; behind: number; branch: string }
  >();

  await Promise.all(
    worktrees.map(async (wt) => {
      const status = await gitStatus(wt.path);
      if (!status.ok) return;
      const staged = status.staged?.length ?? 0;
      const unstaged = status.unstaged?.length ?? 0;
      const untracked = status.untracked?.length ?? 0;
      statusByPath.set(wt.path, {
        dirty: isDirtyStatus(staged, unstaged, untracked),
        ahead: status.ahead ?? 0,
        behind: status.behind ?? 0,
        branch: status.branch ?? wt.branch ?? '',
      });
    }),
  );

  const branchResult = await gitBranches(ws);
  const locked = branchesLockedToOtherWorktrees(worktrees, ws);
  const checkedOutBranches = new Set(
    worktrees.map((wt) => wt.branch).filter((b): b is string => Boolean(b)),
  );

  let localBranches: string[] = [];
  if (branchResult.ok) {
    localBranches = filterUserFacingBranches(branchResult.local ?? [], locked).filter(
      (b) => !checkedOutBranches.has(b),
    );
  }

  const nodes: TopologyNode[] = [];
  const mainWt = worktrees.find((wt) => panelPathsEqual(wt.path, ws)) ?? worktrees[0];
  const linked = worktrees.filter((wt) => !panelPathsEqual(wt.path, ws));

  if (mainWt) {
    const st = statusByPath.get(mainWt.path);
    nodes.push({
      id: `wt:${mainWt.path}`,
      kind: 'root',
      label: formatWorktreeOptionLabel(mainWt, ws),
      cwd: mainWt.path,
      branch: st?.branch ?? mainWt.branch,
      dirty: st?.dirty,
      ahead: st?.ahead,
      behind: st?.behind,
      detached: mainWt.detached,
      children: linked.map((wt) => {
        const childSt = statusByPath.get(wt.path);
        return {
          id: `wt:${wt.path}`,
          kind: 'worktree' as const,
          label: formatWorktreeOptionLabel(wt, ws),
          cwd: wt.path,
          branch: childSt?.branch ?? wt.branch,
          dirty: childSt?.dirty,
          ahead: childSt?.ahead,
          behind: childSt?.behind,
          detached: wt.detached,
        };
      }),
    });
  }

  if (localBranches.length > 0) {
    const groupId = 'local-branches';
    nodes.push({
      id: groupId,
      kind: 'local-branches-group',
      label: `Local branches (${localBranches.length})`,
      children: localBranches.map((branch) => ({
        id: `branch:${branch}`,
        kind: 'branch' as const,
        label: branch,
        branch,
      })),
    });
  }

  if (!branchResult.ok && branchResult.error?.includes('Not a git')) {
    return { nodes: [], repoName, error: 'Not a git repository' };
  }

  return { nodes, repoName };
}

function formatAheadBehind(ahead?: number, behind?: number): string {
  const parts: string[] = [];
  if ((ahead ?? 0) > 0) parts.push(`↑${ahead}`);
  if ((behind ?? 0) > 0) parts.push(`↓${behind}`);
  return parts.join(' ');
}

/** Render the topology tree into a container with ARIA tree semantics. */
export function renderTopologyTree(
  container: HTMLElement,
  model: TopologyTreeModel,
  options: TopologyRenderOptions,
): void {
  container.replaceChildren();

  if (model.error) {
    const err = document.createElement('p');
    err.className = 'git-topology-empty';
    err.textContent = model.error;
    container.appendChild(err);
    return;
  }

  if (model.nodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'git-topology-empty';
    empty.textContent = 'No worktrees';
    container.appendChild(empty);
    return;
  }

  const tree = document.createElement('ul');
  tree.className = 'git-topology-tree';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Repository topology');

  for (const node of model.nodes) {
    tree.appendChild(renderNode(node, 0, options));
  }

  container.appendChild(tree);
}

function renderNode(
  node: TopologyNode,
  depth: number,
  options: TopologyRenderOptions,
): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'git-topology-node';
  li.setAttribute('role', 'treeitem');
  li.setAttribute('aria-level', String(depth + 1));

  const hasChildren = Boolean(node.children && node.children.length > 0);
  const expanded = hasChildren && options.expandedIds.has(node.id);
  if (hasChildren) {
    li.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  const row = document.createElement('div');
  row.className = 'git-topology-row';
  row.dataset.nodeId = node.id;
  if (options.selectedId === node.id) {
    row.classList.add('is-selected');
    li.setAttribute('aria-selected', 'true');
  }

  if (hasChildren) {
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'git-topology-expand';
    expandBtn.setAttribute('aria-label', expanded ? 'Collapse' : 'Expand');
    expandBtn.textContent = expanded ? '▾' : '▸';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      options.onToggleExpand(node.id);
    });
    row.appendChild(expandBtn);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'git-topology-expand-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    row.appendChild(spacer);
  }

  if (node.dirty) {
    const dot = document.createElement('span');
    dot.className = 'git-topology-dirty';
    dot.title = 'Uncommitted changes';
    dot.setAttribute('aria-label', 'Dirty');
    row.appendChild(dot);
  }

  const label = document.createElement('span');
  label.className = 'git-topology-label';
  label.textContent = node.label;
  row.appendChild(label);

  const meta = formatAheadBehind(node.ahead, node.behind);
  if (meta) {
    const ab = document.createElement('span');
    ab.className = 'git-topology-meta';
    ab.textContent = meta;
    row.appendChild(ab);
  }

  row.addEventListener('click', () => options.onSelect(node));
  row.addEventListener('dblclick', () => options.onDoubleClick?.(node));
  if (options.onContextMenu) {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      options.onContextMenu?.(node, e);
    });
  }

  li.appendChild(row);

  if (hasChildren && expanded) {
    const childList = document.createElement('ul');
    childList.setAttribute('role', 'group');
    for (const child of node.children!) {
      childList.appendChild(renderNode(child, depth + 1, options));
    }
    li.appendChild(childList);
  }

  return li;
}

/** Default expanded state: root expanded; local branches collapsed when >5. */
export function defaultExpandedIds(model: TopologyTreeModel): Set<string> {
  const ids = new Set<string>();
  for (const node of model.nodes) {
    if (node.kind === 'root') {
      ids.add(node.id);
    }
    if (node.kind === 'local-branches-group') {
      const count = node.children?.length ?? 0;
      if (count <= 5) ids.add(node.id);
    }
  }
  return ids;
}
