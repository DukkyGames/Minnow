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
  /** Right-click handler for commit rows. */
  onContextMenu?: (visual: CommitVisual, event: MouseEvent) => void;
  /** Highlight the selected commit row (e.g. open in diff panel). */
  selectedSha?: string | null;
  /** Max commits to fetch (default 200). */
  logCount?: number;
}

export interface GitGraphHandle {
  refresh: () => Promise<void>;
  destroy: () => void;
}

/** Vertical line segment for main or branch connectors. */
export type LineSegment = 'none' | 'up' | 'down' | 'both' | 'through';

/** Visual metadata attached to each commit row. */
export interface CommitVisual {
  commit: GitCommitEntry;
  branchKey: string;
  isMain: boolean;
  indentPx: number;
  colorIndex: number;
  isHead: boolean;
  /** Vertical mainline connector behind main dots. */
  mainLine: LineSegment;
  /** Vertical branch connector behind branch dots (same branch color + indent). */
  branchLine?: {
    segment: LineSegment;
    colorIndex: number;
    indentPx: number;
  };
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

/** Local branch names from git log refs (excludes tags and remote-tracking refs). */
export function extractLocalBranchRefs(refs: string[]): string[] {
  const names: string[] = [];
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed || trimmed.startsWith('tag:')) continue;
    if (trimmed.startsWith('origin/') || trimmed.startsWith('remotes/')) continue;

    const headMatch = trimmed.match(/^HEAD -> (.+)$/);
    if (headMatch) {
      names.push(headMatch[1]);
      continue;
    }
    names.push(trimmed);
  }
  return [...new Set(names)];
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

    // Decorator refs beat mainline — merged branches still show on their lane.
    const namedRefs = extractBranchRefs(commit.refs).filter((name) => name !== trunkBranch);
    if (namedRefs.length > 0) {
      assigned.set(commit.hash, namedRefs[0]);
      continue;
    }

    if (mainline.has(commit.hash)) {
      assigned.set(commit.hash, trunkBranch);
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

    assigned.set(commit.hash, `detached:${commit.hash.slice(0, 7)}`);
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
      mainLine: 'none' as const,
    };
  });
}

type LineSegmentMut = LineSegment;

function mergeLineSegment(current: LineSegmentMut, add: 'up' | 'down'): LineSegmentMut {
  if (current === 'through') return 'through';
  if (add === 'up') {
    if (current === 'down') return 'both';
    return current === 'none' ? 'up' : current;
  }
  if (current === 'up') return 'both';
  return current === 'none' ? 'down' : current;
}

/** Build line segments for consecutive member rows in display order. */
export function computeLineSegments(memberIndices: number[], rowCount: number): LineSegment[] {
  const segments: LineSegment[] = Array.from({ length: rowCount }, () => 'none');

  for (let k = 0; k < memberIndices.length - 1; k++) {
    const start = memberIndices[k];
    const end = memberIndices[k + 1];

    segments[start] = mergeLineSegment(segments[start], 'down');

    for (let i = start + 1; i < end; i++) {
      segments[i] = 'through';
    }

    segments[end] = mergeLineSegment(segments[end], 'up');
  }

  return segments;
}

function applyMainLines(visuals: CommitVisual[], segments: LineSegment[]): CommitVisual[] {
  return visuals.map((visual, index) => ({
    ...visual,
    mainLine: segments[index],
  }));
}

/** Mark rows on the vertical line between consecutive main commits. */
export function annotateMainTrunkSegments(visuals: CommitVisual[]): CommitVisual[] {
  const mainIndices = visuals
    .map((visual, index) => (visual.isMain ? index : -1))
    .filter((index) => index >= 0);

  return applyMainLines(visuals, computeLineSegments(mainIndices, visuals.length));
}

/** Whether this branch key can share a connector with other commits. */
export function isConnectableBranchKey(branchKey: string, trunkBranch: string): boolean {
  if (branchKey === trunkBranch) return false;
  if (branchKey.startsWith('detached:')) return false;
  return true;
}

/** Add branch-colored connectors for each named branch (skips detached one-offs). */
export function annotateBranchLineSegments(visuals: CommitVisual[]): CommitVisual[] {
  const trunkBranch = visuals.find((visual) => visual.isMain)?.branchKey ?? 'main';
  const branchKeys = [
    ...new Set(
      visuals
        .map((visual) => visual.branchKey)
        .filter((key) => isConnectableBranchKey(key, trunkBranch)),
    ),
  ];

  let result = visuals.map((visual) => ({ ...visual, branchLine: undefined as CommitVisual['branchLine'] }));

  for (const branchKey of branchKeys) {
    const sample = result.find((visual) => visual.branchKey === branchKey);
    if (!sample) continue;

    const memberIndices = result
      .map((visual, index) => (visual.branchKey === branchKey ? index : -1))
      .filter((index) => index >= 0);

    if (memberIndices.length < 2) continue;

    const segments = computeLineSegments(memberIndices, result.length);
    result = result.map((visual, index) => {
      const segment = segments[index];
      if (segment === 'none') return visual;
      return {
        ...visual,
        branchLine: {
          segment,
          colorIndex: sample.colorIndex,
          indentPx: sample.indentPx,
        },
      };
    });
  }

  return result;
}

/** Annotate main and branch vertical connectors for every row. */
export function annotateCommitLines(visuals: CommitVisual[]): CommitVisual[] {
  return annotateBranchLineSegments(annotateMainTrunkSegments(visuals));
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

function appendConnectorLine(
  row: HTMLElement,
  kind: 'main' | 'branch',
  segment: LineSegment,
  colorIndex?: number,
  indentPx?: number,
): void {
  const line = document.createElement('span');
  line.className =
    kind === 'main'
      ? `git-graph__trunk-line git-graph__trunk-line--${segment}`
      : `git-graph__branch-line git-graph__branch-line--${segment}`;
  line.setAttribute('aria-hidden', 'true');
  if (kind === 'branch' && colorIndex !== undefined) {
    line.style.setProperty('--branch-color', branchColorVar(colorIndex));
    line.style.setProperty('--git-branch-line-indent', `${indentPx ?? 0}px`);
  }
  row.appendChild(line);
}

function renderRow(
  visual: CommitVisual,
  onSelect?: (sha: string) => void,
  selectedSha?: string | null,
  onContextMenu?: (visual: CommitVisual, event: MouseEvent) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'git-graph__row';
  if (!visual.isMain) row.classList.add('git-graph__row--branch');
  if (selectedSha && (visual.commit.hash === selectedSha || visual.commit.hash.startsWith(selectedSha))) {
    row.classList.add('git-graph__row--selected');
  }
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

  if (onContextMenu) {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onContextMenu(visual, e);
    });
  }

  const dot = document.createElement('span');
  dot.className = 'git-graph__dot';
  dot.setAttribute('aria-hidden', 'true');
  if (visual.isMain) dot.classList.add('git-graph__dot--main');
  else dot.classList.add('git-graph__dot--branch');
  if (visual.isHead) dot.classList.add('git-graph__dot--head');
  dot.style.setProperty('--branch-color', branchColorVar(visual.colorIndex));

  const body = document.createElement('div');
  body.className = 'git-graph__body';

  const marker = document.createElement('div');
  marker.className = 'git-graph__marker';

  // Lines live in the marker column but span the full row height (anchored to body).
  if (visual.mainLine !== 'none') {
    appendConnectorLine(marker, 'main', visual.mainLine);
  }

  if (visual.branchLine) {
    appendConnectorLine(
      marker,
      'branch',
      visual.branchLine.segment,
      visual.branchLine.colorIndex,
      visual.branchLine.indentPx,
    );
  }

  marker.appendChild(dot);

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
  selectedSha?: string | null,
  onContextMenu?: (visual: CommitVisual, event: MouseEvent) => void,
): void {
  host.className = 'git-graph git-panel-graph-mount';
  host.replaceChildren();

  const list = document.createElement('div');
  list.className = 'git-graph__list';
  for (const visual of visuals) {
    list.appendChild(renderRow(visual, onSelect, selectedSha, onContextMenu));
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

    const count = options.logCount ?? LOG_COUNT;
    const result = await gitLog({ count, cwd: options.cwd });
    if (!result.ok) {
      renderEmpty(host, result.error ?? 'Could not load history');
      return;
    }

    const commits = result.commits ?? [];
    if (commits.length === 0) {
      renderEmpty(host, 'No commits');
      return;
    }

    const visuals = annotateCommitLines(assignCommitVisuals(commits));
    renderGraph(
      host,
      visuals,
      options.onSelectCommit,
      options.selectedSha,
      options.onContextMenu,
    );
  };

  const destroy = (): void => {
    destroyed = true;
    host.replaceChildren();
    host.className = '';
  };

  void refresh();

  return { refresh, destroy };
}
