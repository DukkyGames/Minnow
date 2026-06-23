/**
 * Commit history graph for the git source control panel (MIN-198 P2).
 *
 * Integration: mount via `renderGitGraph(host, options)` on `#gitGraphMount`
 * inside [`git-panel.ts`](./git-panel.ts). Pass `onSelectCommit` to show diffs.
 */

import { gitLog, type GitCommitEntry } from '../state/git-api';

const LOG_COUNT = 200;
const LANE_COLORS = 8;

export interface GitGraphOptions {
  cwd?: string;
  onSelectCommit?: (sha: string) => void;
  /** Single-dot rows for narrow sidebars (no multi-lane connectors). */
  compact?: boolean;
}

export interface GitGraphHandle {
  refresh: () => Promise<void>;
  destroy: () => void;
}

/** Per-commit lane layout metadata used when rendering rows. */
interface CommitLayout {
  commit: GitCommitEntry;
  lane: number;
  laneCount: number;
  mergeFrom: number[];
  branchTo: number[];
  activeAbove: boolean[];
  activeBelow: boolean[];
  isHead: boolean;
}

/** Whether any ref string marks this commit as current HEAD. */
function commitIsHead(refs: string[]): boolean {
  return refs.some((r) => /\bHEAD\b/.test(r));
}

/** Lane color token cycling through --git-lane-N custom properties. */
function laneColorVar(laneIndex: number): string {
  return `var(--git-lane-${laneIndex % LANE_COLORS})`;
}

/**
 * Greedy lane assignment (newest-first log order).
 * Each commit takes the leftmost lane waiting for it; branch parents open lanes;
 * merge commits close extra lanes into the primary lane.
 */
export function computeCommitLayouts(commits: GitCommitEntry[]): CommitLayout[] {
  if (commits.length === 0) return [];

  const hashSet = new Set(commits.map((c) => c.hash));
  const activeTips = new Map<number, string>();
  const freeLanes: number[] = [];
  let maxLane = 0;

  const partial: Array<{
    commit: GitCommitEntry;
    lane: number;
    mergeFrom: number[];
    branchTo: number[];
  }> = [];

  for (const commit of commits) {
    const waiting = [...activeTips.entries()]
      .filter(([, hash]) => hash === commit.hash)
      .map(([lane]) => lane)
      .sort((a, b) => a - b);

    let lane: number;
    let mergeFrom: number[] = [];

    if (waiting.length > 0) {
      lane = waiting[0];
      mergeFrom = waiting.slice(1);
      for (const l of waiting) activeTips.delete(l);
    } else if (freeLanes.length > 0) {
      lane = freeLanes.shift()!;
    } else {
      lane = maxLane;
      maxLane += 1;
    }

    const parents = commit.parents.filter((p) => hashSet.has(p));
    const branchTo: number[] = [];

    if (parents.length > 0) {
      activeTips.set(lane, parents[0]);
    } else {
      freeLanes.push(lane);
      freeLanes.sort((a, b) => a - b);
    }

    for (let i = 1; i < parents.length; i++) {
      let parentLane: number;
      if (freeLanes.length > 0) {
        parentLane = freeLanes.shift()!;
      } else {
        parentLane = maxLane;
        maxLane += 1;
      }
      activeTips.set(parentLane, parents[i]);
      branchTo.push(parentLane);
    }

    partial.push({ commit, lane, mergeFrom, branchTo });
  }

  const laneCount = Math.max(1, maxLane);
  const activeBetween: boolean[][] = commits.map(() => Array(laneCount).fill(false));

  for (let i = 0; i < commits.length - 1; i++) {
    const curr = partial[i];
    const next = partial[i + 1];
    const nextHash = commits[i + 1].hash;

    if (
      curr.commit.parents[0] === nextHash &&
      curr.lane === next.lane
    ) {
      activeBetween[i][curr.lane] = true;
    }

    for (const branchLane of curr.branchTo) {
      if (next.lane === branchLane && curr.commit.parents.includes(nextHash)) {
        activeBetween[i][branchLane] = true;
      }
    }

    for (const mergeLane of next.mergeFrom) {
      activeBetween[i][mergeLane] = true;
    }
  }

  return partial.map((entry, index) => {
    const activeBelowRaw = activeBetween[index] ?? Array(laneCount).fill(false);
    const activeBelow =
      index === partial.length - 1
        ? Array(laneCount).fill(false)
        : activeBelowRaw;
    const activeAbove =
      index > 0
        ? (activeBetween[index - 1] ?? Array(laneCount).fill(false))
        : Array(laneCount).fill(false);

    return {
      commit: entry.commit,
      lane: entry.lane,
      laneCount,
      mergeFrom: entry.mergeFrom,
      branchTo: entry.branchTo,
      activeAbove,
      activeBelow,
      isHead: commitIsHead(entry.commit.refs),
    };
  });
}

function renderRefChip(ref: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'git-graph__ref-chip';
  chip.textContent = ref.replace(/^HEAD -> /, '');
  chip.title = ref;
  return chip;
}

function renderRow(
  layout: CommitLayout,
  onSelect?: (sha: string) => void,
  compact = false,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'git-graph__row';
  if (compact) row.classList.add('git-graph__row--compact');
  row.dataset.sha = layout.commit.hash;
  row.title = layout.commit.subject;

  if (onSelect) {
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.addEventListener('click', () => onSelect(layout.commit.hash));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(layout.commit.hash);
      }
    });
  }

  const content = document.createElement('div');
  content.className = 'git-graph__content';

  const subject = document.createElement('span');
  subject.className = 'git-graph__subject';
  subject.textContent = layout.commit.subject;

  const meta = document.createElement('div');
  meta.className = 'git-graph__meta';

  const author = document.createElement('span');
  author.className = 'git-graph__author';
  author.textContent = layout.commit.author;

  const time = document.createElement('span');
  time.className = 'git-graph__time';
  time.textContent = layout.commit.relativeTime;

  meta.append(author, time);

  const refsEl = document.createElement('div');
  refsEl.className = 'git-graph__refs';
  for (const ref of layout.commit.refs) {
    refsEl.appendChild(renderRefChip(ref));
  }

  content.append(subject, meta, refsEl);

  const lanesEl = document.createElement('div');
  lanesEl.className = compact ? 'git-graph__lanes git-graph__lanes--compact' : 'git-graph__lanes';

  if (compact) {
    const dot = document.createElement('div');
    dot.className = 'git-graph__dot';
    dot.style.setProperty('--lane-color', laneColorVar(layout.lane));
    if (layout.isHead) dot.classList.add('git-graph__dot--head');
    dot.setAttribute('aria-hidden', 'true');
    lanesEl.appendChild(dot);
  } else {
    lanesEl.style.setProperty('--lane-count', String(layout.laneCount));
    lanesEl.style.setProperty('--dot-lane', String(layout.lane));

    for (let lane = 0; lane < layout.laneCount; lane++) {
      const laneEl = document.createElement('div');
      laneEl.className = 'git-graph__lane';
      laneEl.style.setProperty('--lane-color', laneColorVar(lane));

      if (layout.activeAbove[lane]) laneEl.classList.add('git-graph__lane--above');
      if (layout.activeBelow[lane]) laneEl.classList.add('git-graph__lane--below');
      if (layout.mergeFrom.includes(lane)) laneEl.classList.add('git-graph__lane--merge');
      if (layout.branchTo.includes(lane)) laneEl.classList.add('git-graph__lane--branch');

      lanesEl.appendChild(laneEl);
    }

    const dot = document.createElement('div');
    dot.className = 'git-graph__dot';
    dot.style.setProperty('--lane-color', laneColorVar(layout.lane));
    if (layout.isHead) dot.classList.add('git-graph__dot--head');
    dot.setAttribute('aria-hidden', 'true');
    lanesEl.appendChild(dot);
  }

  row.append(content, lanesEl);
  return row;
}

function renderEmpty(host: HTMLElement, message: string): void {
  host.className = 'git-graph git-panel-graph-mount';
  host.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'git-graph__empty';
  empty.textContent = message;
  host.appendChild(empty);
}

function renderGraph(
  host: HTMLElement,
  layouts: CommitLayout[],
  onSelect?: (sha: string) => void,
  compact = false,
): void {
  host.className = compact ? 'git-graph git-graph--compact git-panel-graph-mount' : 'git-graph git-panel-graph-mount';
  host.replaceChildren();

  const list = document.createElement('div');
  list.className = 'git-graph__list';
  for (const layout of layouts) {
    list.appendChild(renderRow(layout, onSelect, compact));
  }
  host.appendChild(list);
}

/**
 * Render a commit lane graph into `host`.
 * Fetches up to 200 commits via `gitLog`; call `refresh` after cwd changes.
 */
export function renderGitGraph(
  host: HTMLElement,
  options: GitGraphOptions = {},
): GitGraphHandle {
  let destroyed = false;

  const refresh = async (): Promise<void> => {
    if (destroyed) return;

    const result = await gitLog({ count: LOG_COUNT, cwd: options.cwd });
    if (!result.ok) {
      renderEmpty(host, result.error ?? 'Could not load history');
      return;
    }

    const commits = result.commits ?? [];
    if (commits.length === 0) {
      renderEmpty(host, 'No commits');
      return;
    }

    const layouts = computeCommitLayouts(commits);
    renderGraph(host, layouts, options.onSelectCommit, options.compact === true);
  };

  const destroy = (): void => {
    destroyed = true;
    host.replaceChildren();
    host.className = '';
  };

  void refresh();

  return { refresh, destroy };
}
