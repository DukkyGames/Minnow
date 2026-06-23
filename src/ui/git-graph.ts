/**
 * Commit history list for the git source control panel (MIN-198 P2).
 *
 * Each row shows a branch-colored dot (accent for main) and indents
 * commits that are not on the mainline.
 */

import { gitLog, type GitCommitEntry } from '../state/git-api';

const LOG_COUNT = 200;
const BRANCH_COLORS = 7;
/** Extra left padding for commits on a side branch. */
const BRANCH_INDENT_PX = 14;

export interface GitGraphOptions {
  cwd?: string;
  onSelectCommit?: (sha: string) => void;
}

export interface GitGraphHandle {
  refresh: () => Promise<void>;
  destroy: () => void;
}

/** Visual metadata attached to each commit row. */
export interface CommitVisual {
  commit: GitCommitEntry;
  branchKey: string;
  isMain: boolean;
  indentPx: number;
  colorIndex: number;
  isHead: boolean;
  /** Vertical main-trunk line segment drawn in the left gutter. */
  trunkSegment: 'none' | 'up' | 'down' | 'both' | 'through';
}

function commitIsHead(refs: string[]): boolean {
  return refs.some((r) => /\bHEAD\b/.test(r));
}

/** Parse a git log ref string into a short branch name, when possible. */
export function normalizeBranchRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('tag:')) return null;

  const headMatch = trimmed.match(/^HEAD -> (.+)$/);
  if (headMatch) return headMatch[1];

  if (trimmed.startsWith('origin/')) {
    const remote = trimmed.slice('origin/'.length);
    if (remote === 'HEAD') return null;
    return remote;
  }

  if (trimmed.startsWith('remotes/origin/')) {
    const remote = trimmed.slice('remotes/origin/'.length);
    if (remote === 'HEAD') return null;
    return remote;
  }

  return trimmed;
}

function extractBranchRefs(refs: string[]): string[] {
  const names: string[] = [];
  for (const ref of refs) {
    const name = normalizeBranchRef(ref);
    if (name) names.push(name);
  }
  return names;
}

/** Prefer `main`, then `master`, otherwise the branch at HEAD. */
export function detectTrunkBranch(commits: GitCommitEntry[]): string {
  for (const trunk of ['main', 'master']) {
    for (const commit of commits) {
      if (extractBranchRefs(commit.refs).includes(trunk)) return trunk;
    }
  }

  const headCommit = commits.find((c) => commitIsHead(c.refs));
  const headBranches = headCommit ? extractBranchRefs(headCommit.refs) : [];
  return headBranches[0] ?? 'main';
}

/** Hashes on the trunk via first-parent walk from the newest trunk tip. */
export function buildMainlineSet(commits: GitCommitEntry[], trunkBranch: string): Set<string> {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const tip =
    commits.find((c) => commitIsHead(c.refs) && extractBranchRefs(c.refs).includes(trunkBranch)) ??
    commits.find((c) => extractBranchRefs(c.refs).includes(trunkBranch)) ??
    commits[0];

  const mainline = new Set<string>();
  let hash: string | undefined = tip?.hash;
  while (hash) {
    mainline.add(hash);
    hash = byHash.get(hash)?.parents[0];
  }
  return mainline;
}

/**
 * Assign each commit a branch key, dot color, and indent.
 * Mainline commits use the accent color with no indent; side branches are indented.
 */
export function assignCommitVisuals(
  commits: GitCommitEntry[],
  trunkBranch = detectTrunkBranch(commits),
): CommitVisual[] {
  const mainline = buildMainlineSet(commits, trunkBranch);
  const assigned = new Map<string, string>();
  const branchColor = new Map<string, number>();
  let nextColor = 1;

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    if (mainline.has(commit.hash)) {
      assigned.set(commit.hash, trunkBranch);
      continue;
    }

    const refs = extractBranchRefs(commit.refs).filter((name) => name !== trunkBranch);
    if (refs.length > 0) {
      assigned.set(commit.hash, refs[0]);
      continue;
    }

    if (i > 0) {
      const newer = commits[i - 1];
      const newerBranch = assigned.get(newer.hash);
      if (newerBranch && newerBranch !== trunkBranch && newer.parents.includes(commit.hash)) {
        assigned.set(commit.hash, newerBranch);
        continue;
      }
    }

    const parent = commit.parents[0];
    const parentBranch = parent ? assigned.get(parent) : undefined;
    if (parentBranch && parentBranch !== trunkBranch) {
      assigned.set(commit.hash, parentBranch);
      continue;
    }

    assigned.set(commit.hash, 'branch');
  }

  return commits.map((commit) => {
    const branchKey = assigned.get(commit.hash) ?? trunkBranch;
    const isMain = branchKey === trunkBranch;

    if (!isMain && !branchColor.has(branchKey)) {
      branchColor.set(branchKey, nextColor++);
    }

    return {
      commit,
      branchKey,
      isMain,
      indentPx: isMain ? 0 : BRANCH_INDENT_PX,
      colorIndex: isMain ? 0 : (branchColor.get(branchKey) ?? 1),
      isHead: commitIsHead(commit.refs),
      trunkSegment: 'none' as const,
    };
  });
}

type TrunkSegment = CommitVisual['trunkSegment'];

function mergeTrunkSegment(current: TrunkSegment, add: 'up' | 'down'): TrunkSegment {
  if (current === 'through') return 'through';
  if (add === 'up') {
    if (current === 'down') return 'both';
    return current === 'none' ? 'up' : current;
  }
  if (current === 'up') return 'both';
  return current === 'none' ? 'down' : current;
}

/** Mark rows that sit on the vertical line between consecutive main commits. */
export function annotateMainTrunkSegments(visuals: CommitVisual[]): CommitVisual[] {
  const mainIndices = visuals
    .map((visual, index) => (visual.isMain ? index : -1))
    .filter((index) => index >= 0);

  const segments: TrunkSegment[] = visuals.map(() => 'none');

  for (let k = 0; k < mainIndices.length - 1; k++) {
    const start = mainIndices[k];
    const end = mainIndices[k + 1];

    segments[start] = mergeTrunkSegment(segments[start], 'down');

    for (let i = start + 1; i < end; i++) {
      segments[i] = 'through';
    }

    segments[end] = mergeTrunkSegment(segments[end], 'up');
  }

  return visuals.map((visual, index) => ({
    ...visual,
    trunkSegment: segments[index],
  }));
}

function branchColorVar(colorIndex: number): string {
  if (colorIndex === 0) return 'var(--mn-accent)';
  return `var(--git-lane-${((colorIndex - 1) % BRANCH_COLORS) + 1})`;
}

function renderRefChip(ref: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'git-graph__ref-chip';
  chip.textContent = ref.replace(/^HEAD -> /, '');
  chip.title = ref;
  return chip;
}

function renderRow(visual: CommitVisual, onSelect?: (sha: string) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'git-graph__row';
  if (!visual.isMain) row.classList.add('git-graph__row--branch');
  row.dataset.sha = visual.commit.hash;
  row.title = `${visual.commit.subject} (${visual.branchKey})`;

  if (onSelect) {
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.addEventListener('click', () => onSelect(visual.commit.hash));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(visual.commit.hash);
      }
    });
  }

  const dot = document.createElement('span');
  dot.className = 'git-graph__dot';
  dot.setAttribute('aria-hidden', 'true');
  if (visual.isMain) dot.classList.add('git-graph__dot--main');
  else dot.classList.add('git-graph__dot--branch');
  if (visual.isHead) dot.classList.add('git-graph__dot--head');
  dot.style.setProperty('--branch-color', branchColorVar(visual.colorIndex));

  const marker = document.createElement('div');
  marker.className = 'git-graph__marker';
  marker.appendChild(dot);

  if (visual.trunkSegment !== 'none') {
    const line = document.createElement('span');
    line.className = `git-graph__trunk-line git-graph__trunk-line--${visual.trunkSegment}`;
    line.setAttribute('aria-hidden', 'true');
    row.appendChild(line);
  }

  const body = document.createElement('div');
  body.className = 'git-graph__body';

  const content = document.createElement('div');
  content.className = 'git-graph__content';

  if (visual.indentPx > 0) {
    body.style.setProperty('--git-branch-indent', `${visual.indentPx}px`);
  }

  const subject = document.createElement('span');
  subject.className = 'git-graph__subject';
  subject.textContent = visual.commit.subject;

  const meta = document.createElement('div');
  meta.className = 'git-graph__meta';

  const author = document.createElement('span');
  author.className = 'git-graph__author';
  author.textContent = visual.commit.author;

  const time = document.createElement('span');
  time.className = 'git-graph__time';
  time.textContent = visual.commit.relativeTime;

  meta.append(author, time);

  if (visual.commit.refs.length > 0) {
    const refsEl = document.createElement('div');
    refsEl.className = 'git-graph__refs';
    for (const ref of visual.commit.refs) {
      refsEl.appendChild(renderRefChip(ref));
    }
    content.append(subject, meta, refsEl);
  } else {
    content.append(subject, meta);
  }

  row.append(body);
  body.append(marker, content);
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
  visuals: CommitVisual[],
  onSelect?: (sha: string) => void,
): void {
  host.className = 'git-graph git-panel-graph-mount';
  host.replaceChildren();

  const list = document.createElement('div');
  list.className = 'git-graph__list';
  for (const visual of visuals) {
    list.appendChild(renderRow(visual, onSelect));
  }
  host.appendChild(list);
}

/**
 * Render commit history into `host`.
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

    const visuals = annotateMainTrunkSegments(assignCommitVisuals(commits));
    renderGraph(host, visuals, options.onSelectCommit);
  };

  const destroy = (): void => {
    destroyed = true;
    host.replaceChildren();
    host.className = '';
  };

  void refresh();

  return { refresh, destroy };
}
