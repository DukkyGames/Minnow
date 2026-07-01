/**
 * Commit diff review panel in the workspace split (side-by-side per file).
 */

import { gitShow } from '../state/git-api';
import { showViewerSplit, hideViewerSplit } from './file-layout';
import { dismissFileViewerForPreview } from './file-viewer';
import { basename } from './file-tree-path';
import {
  countPatchLineStats,
  splitPatchIntoFiles,
  type GitPatchFileEntry,
} from './git-patch-files';
import { renderSideBySidePatchDiff } from './side-by-side-patch-diff';

export interface GitCommitDiffPanelOptions {
  sha: string;
  cwd?: string;
  subject?: string;
}

/** Dispatched when the commit diff panel closes (any path). */
export const GIT_COMMIT_DIFF_CLOSED_EVENT = 'minnow:git-commit-diff-closed';

let openSha: string | null = null;
let paneMarked = false;
let activeFileIndex = 0;
let fileEntries: GitPatchFileEntry[] = [];
let diffBodyEl: HTMLElement | null = null;
let fileTabsEl: HTMLElement | null = null;

function getViewerPane(): HTMLElement | null {
  return document.getElementById('fileViewerPane');
}

function getViewerHost(): HTMLElement | null {
  return document.getElementById('fileViewerHost');
}

/** True when the commit diff panel is showing in the file viewer split. */
export function isGitCommitDiffPanelOpen(): boolean {
  return openSha !== null;
}

/** Currently displayed commit sha, if any. */
export function getOpenGitCommitDiffSha(): string | null {
  return openSha;
}

function appendFileTabStats(parent: HTMLElement, entry: GitPatchFileEntry): void {
  const { additions, deletions } = countPatchLineStats(entry.patch);
  const badge = document.createElement('span');
  badge.className = 'git-commit-diff__file-tab-stats';

  if (additions > 0) {
    const add = document.createElement('span');
    add.className = 'code-change-strip__add';
    add.textContent = `+${additions}`;
    badge.appendChild(add);
  }
  if (deletions > 0) {
    if (additions > 0) badge.appendChild(document.createTextNode(' '));
    const del = document.createElement('span');
    del.className = 'code-change-strip__del';
    del.textContent = `−${deletions}`;
    badge.appendChild(del);
  }

  parent.appendChild(badge);
}

function renderFileDiff(index: number): void {
  if (!diffBodyEl) return;
  const entry = fileEntries[index];
  if (!entry) {
    diffBodyEl.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'git-commit-diff__empty';
    empty.textContent = 'No file changes in this commit.';
    diffBodyEl.appendChild(empty);
    return;
  }

  diffBodyEl.replaceChildren();

  const labels = document.createElement('div');
  labels.className = 'git-commit-diff__column-labels';
  const leftLabel = document.createElement('span');
  leftLabel.className = 'git-commit-diff__column-label';
  leftLabel.textContent = entry.oldPath ? `${entry.oldPath} (parent)` : `${entry.path} (parent)`;
  const rightLabel = document.createElement('span');
  rightLabel.className = 'git-commit-diff__column-label';
  rightLabel.textContent = entry.path;
  labels.append(leftLabel, rightLabel);
  diffBodyEl.appendChild(labels);

  if (entry.binary) {
    const note = document.createElement('p');
    note.className = 'git-commit-diff__binary';
    note.textContent = 'Binary file changed (no text diff).';
    diffBodyEl.appendChild(note);
    return;
  }

  const mount = document.createElement('div');
  mount.className = 'git-commit-diff__diff-mount';
  diffBodyEl.appendChild(mount);
  renderSideBySidePatchDiff(mount, entry.patch);
}

function selectFile(index: number): void {
  if (index < 0 || index >= fileEntries.length) return;
  activeFileIndex = index;
  if (!fileTabsEl) return;

  const tabs = fileTabsEl.querySelectorAll<HTMLButtonElement>('.git-commit-diff__file-tab');
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
  });

  renderFileDiff(index);
}

function buildFileTabs(): void {
  if (!fileTabsEl) return;
  fileTabsEl.replaceChildren();

  if (fileEntries.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'git-commit-diff__no-files';
    empty.textContent = 'No files changed';
    fileTabsEl.appendChild(empty);
    return;
  }

  fileEntries.forEach((entry, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'git-commit-diff__file-tab';
    tab.setAttribute('role', 'tab');
    tab.title = entry.path;

    const name = document.createElement('span');
    name.className = 'git-commit-diff__file-tab-name';
    name.textContent = basename(entry.path);

    tab.append(name);
    appendFileTabStats(tab, entry);
    tab.addEventListener('click', () => selectFile(index));
    fileTabsEl.appendChild(tab);
  });
}

function markViewerPane(): void {
  const pane = getViewerPane();
  if (!pane || paneMarked) return;
  pane.classList.add('file-viewer-pane--commit-diff');
  paneMarked = true;
}

function unmarkViewerPane(): void {
  const pane = getViewerPane();
  if (!pane || !paneMarked) return;
  pane.classList.remove('file-viewer-pane--commit-diff');
  paneMarked = false;
}

function createCloseButton(): HTMLButtonElement {
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'btnGitCommitDiffClose';
  closeBtn.className = 'icon-btn git-commit-diff-close';
  closeBtn.setAttribute('aria-label', 'Close commit diff');
  closeBtn.title = 'Close';
  closeBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('click', () => closeGitCommitDiffPanel());
  return closeBtn;
}

function mountPanelChrome(shortSha: string, subject: string, statLine: string): void {
  const host = getViewerHost();
  if (!host) return;

  host.replaceChildren();
  host.classList.add('git-commit-diff-host');

  const shell = document.createElement('div');
  shell.className = 'git-commit-diff';

  const meta = document.createElement('div');
  meta.className = 'git-commit-diff__meta';

  const metaText = document.createElement('div');
  metaText.className = 'git-commit-diff__meta-text';
  const title = document.createElement('h2');
  title.className = 'git-commit-diff__title';
  title.textContent = subject || `Commit ${shortSha}`;
  const detail = document.createElement('p');
  detail.className = 'git-commit-diff__detail';
  detail.textContent = statLine ? `${shortSha} — ${statLine}` : shortSha;
  metaText.append(title, detail);

  meta.append(metaText, createCloseButton());

  fileTabsEl = document.createElement('div');
  fileTabsEl.className = 'git-commit-diff__file-tabs';
  fileTabsEl.setAttribute('role', 'tablist');
  fileTabsEl.setAttribute('aria-label', 'Changed files');

  diffBodyEl = document.createElement('div');
  diffBodyEl.className = 'git-commit-diff__body';

  shell.append(meta, fileTabsEl, diffBodyEl);
  host.appendChild(shell);
}

/** Result of attempting to open the commit diff panel. */
export type GitCommitDiffOpenResult =
  | { ok: true }
  | { ok: false; error?: string; cancelled?: boolean };

/** Open or focus the commit diff panel for `sha`. Re-clicking the same sha closes it. */
export async function openGitCommitDiffPanel(
  options: GitCommitDiffPanelOptions,
): Promise<GitCommitDiffOpenResult> {
  const sha = options.sha.trim();
  if (!sha) return { ok: false, error: 'sha is required' };

  if (openSha === sha) {
    closeGitCommitDiffPanel();
    return { ok: true };
  }

  const result = await gitShow({ sha, cwd: options.cwd });
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Could not load commit' };
  }

  if (!dismissFileViewerForPreview()) {
    return { ok: false, cancelled: true };
  }

  showViewerSplit();
  markViewerPane();

  openSha = sha;
  fileEntries = splitPatchIntoFiles(result.patch ?? '');
  activeFileIndex = 0;

  const shortSha = sha.slice(0, 7);
  const statLine = result.stat?.trim().split('\n').pop()?.trim() ?? '';
  const subject = options.subject?.trim() ?? '';

  mountPanelChrome(shortSha, subject, statLine);
  buildFileTabs();
  selectFile(0);

  return { ok: true };
}

/** Close the commit diff panel and hide the viewer split when empty. */
export function closeGitCommitDiffPanel(): void {
  if (!openSha) return;

  openSha = null;
  fileEntries = [];
  activeFileIndex = 0;
  fileTabsEl = null;
  diffBodyEl = null;

  const host = getViewerHost();
  if (host) {
    host.classList.remove('git-commit-diff-host');
    host.replaceChildren();
  }

  unmarkViewerPane();

  hideViewerSplit();

  window.dispatchEvent(new CustomEvent(GIT_COMMIT_DIFF_CLOSED_EVENT));
}
