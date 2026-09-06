/**
 * GitHub identity + sync controls that live inside the Issues peek Git section.
 *
 * Open always goes through `openExternal` (system browser). Sync/Push share
 * one click handler so the toolbar Push and the linked-row Sync cannot drift.
 */

import {
  getIssuesGithubMode,
  resolveSyncConflict,
  syncIssueWithGithub,
  type SyncConflict,
} from '../state/issues-github';
import { githubSyncCaption } from '../issues/github-sync-status';
import type { IssueCard } from '../types';
import { openExternalGitUrl } from '../chat/issues/git-actions';
import { showToast } from './toast';

/** Called after any change so the panel re-renders from store state. */
export type GithubSectionChanged = () => void;

export type GithubSyncButtonOptions = {
  idleLabel: string;
  conflictHost: HTMLElement;
  onChanged: GithubSectionChanged;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string, max = 400): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

let liveConflictTarget: {
  issueId: string;
  host: HTMLElement;
  onChanged: GithubSectionChanged;
} | null = null;
const pendingConflicts = new Map<string, SyncConflict>();

/** Two-way mirror is the only mode that may contact GitHub. */
export function githubSyncEnabled(): boolean {
  return getIssuesGithubMode() === 'mirror';
}

function showConflict(
  host: HTMLElement,
  conflict: SyncConflict,
  onChanged: GithubSectionChanged,
): void {
  host.replaceChildren(buildConflictPane(conflict, onChanged));
}

/** Peek Git section registers where Keep mine / Keep GitHub should mount. */
export function registerGithubConflictHost(
  issueId: string,
  host: HTMLElement,
  onChanged: GithubSectionChanged,
): void {
  liveConflictTarget = { issueId, host, onChanged };
  const pending = pendingConflicts.get(issueId);
  if (pending) showConflict(host, pending, onChanged);
}

/** Drop the live host when peek closes. Pending conflicts stay until resolved. */
export function clearGithubConflictHost(issueId?: string): void {
  if (!issueId || liveConflictTarget?.issueId === issueId) {
    liveConflictTarget = null;
  }
}

/**
 * Show the conflict pane when this issue's peek is open.
 * Returns false when the caller should toast instead.
 */
export function presentGithubSyncConflict(conflict: SyncConflict): boolean {
  pendingConflicts.set(conflict.issueId, conflict);
  if (liveConflictTarget?.issueId !== conflict.issueId) return false;
  if (!liveConflictTarget.host.isConnected) return false;
  showConflict(liveConflictTarget.host, conflict, liveConflictTarget.onChanged);
  return true;
}

function clearPendingConflict(issueId: string): void {
  pendingConflicts.delete(issueId);
}

// ── Conflict ─────────────────────────────────────────────────────────────────

function buildConflictPane(
  conflict: SyncConflict,
  onChanged: GithubSectionChanged,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'issues-github__conflict';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'GitHub sync conflict');

  const head = document.createElement('p');
  head.className = 'issues-github__conflict-head';
  head.textContent =
    'Both sides changed since the last sync. Pick which to keep. Neither is overwritten until you do.';
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'issues-github__conflict-grid';

  const side = (
    label: string,
    fields: SyncConflict['local'],
    keep: 'local' | 'remote',
  ): HTMLElement => {
    const column = document.createElement('div');
    column.className = 'issues-github__conflict-side';

    const title = document.createElement('h4');
    title.className = 'issues-github__conflict-label';
    title.textContent = label;
    column.appendChild(title);

    const heading = document.createElement('p');
    heading.className = 'issues-github__conflict-title';
    heading.textContent = fields.title;
    column.appendChild(heading);

    const body = document.createElement('pre');
    body.className = 'issues-github__conflict-body';
    body.textContent = truncate(fields.body) || '(no description)';
    column.appendChild(body);

    const meta = document.createElement('p');
    meta.className = 'issues-github__conflict-meta';
    meta.textContent = `${fields.closed ? 'closed' : 'open'}${
      fields.labels.length ? ` · ${fields.labels.join(', ')}` : ''
    }`;
    column.appendChild(meta);

    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'issues-btn';
    keepBtn.textContent = keep === 'local' ? 'Keep mine' : 'Keep GitHub';
    keepBtn.addEventListener('click', () => {
      keepBtn.disabled = true;
      void resolveSyncConflict(conflict, keep)
        .then((outcome) => {
          if (!outcome.ok) {
            showToast(outcome.error ?? 'Could not resolve the conflict', 'error');
            keepBtn.disabled = false;
            return;
          }
          clearPendingConflict(conflict.issueId);
          showToast(keep === 'local' ? 'Pushed your version' : 'Took the GitHub version', 'success');
          onChanged();
        })
        .catch(() => {
          showToast('Could not resolve the conflict', 'error');
          keepBtn.disabled = false;
        });
    });
    column.appendChild(keepBtn);
    return column;
  };

  grid.append(side('Yours', conflict.local, 'local'), side('GitHub', conflict.remote, 'remote'));
  wrap.appendChild(grid);
  return wrap;
}

// ── Sync action ──────────────────────────────────────────────────────────────

/** Wire Push / Sync to the same forge path. Idle label is restored on failure. */
export function bindGithubSyncButton(
  btn: HTMLButtonElement,
  issue: IssueCard,
  options: GithubSyncButtonOptions,
): void {
  btn.addEventListener('click', () => {
    const idle = options.idleLabel;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    void syncIssueWithGithub(issue.id)
      .then((outcome) => {
        if (outcome.conflict) {
          btn.disabled = false;
          btn.textContent = idle;
          showConflict(options.conflictHost, outcome.conflict, options.onChanged);
          return;
        }
        if (!outcome.ok) {
          btn.disabled = false;
          btn.textContent = idle;
          showToast(outcome.error ?? 'Sync failed', 'error');
          return;
        }
        if (outcome.droppedLabels) {
          showToast('Created on GitHub. Some labels do not exist there and were dropped.', 'success');
        } else if (outcome.action === 'noop') {
          showToast(outcome.error ?? 'Already in sync', 'success');
        } else {
          showToast(outcome.action === 'pull' ? 'Took the GitHub version' : 'Pushed to GitHub', 'success');
        }
        options.onChanged();
      })
      .catch(() => {
        btn.disabled = false;
        btn.textContent = idle;
        showToast('Sync failed', 'error');
      });
  });
}

// ── Linked row ───────────────────────────────────────────────────────────────

/**
 * First Git-list row for a linked GitHub issue: `#n · synced …` / Needs push,
 * Open in the system browser, and Sync when Two-way mirror is on.
 */
export function buildGithubIssueChip(
  issue: IssueCard,
  options: { canSync: boolean; conflictHost: HTMLElement; onChanged: GithubSectionChanged },
): HTMLLIElement {
  const link = issue.github;
  const number = link?.number ?? 0;
  const url = link?.url?.trim() ?? '';
  const caption = githubSyncCaption(issue);
  const needsPush = caption === 'Needs push';

  const li = document.createElement('li');
  li.className = 'issues-detail__git-chip issues-detail__git-chip--github';

  const identity = document.createElement('span');
  identity.className = 'issues-detail__git-chip-label';

  const ref = document.createElement('span');
  ref.className = 'issues-detail__git-chip-ref';
  ref.textContent = `#${number}`;
  identity.appendChild(ref);

  if (caption) {
    const status = document.createElement('span');
    status.className = 'issues-detail__git-chip-status';
    if (needsPush) status.classList.add('is-needs-push');
    status.textContent = ` · ${caption}`;
    identity.appendChild(status);
  }
  li.appendChild(identity);

  const actions = document.createElement('span');
  actions.className = 'issues-detail__git-chip-actions';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'issues-btn issues-detail__git-open';
  openBtn.textContent = 'Open';
  openBtn.title = 'Open on GitHub in your browser';
  openBtn.setAttribute('aria-label', `Open GitHub issue #${number} in your browser`);
  openBtn.disabled = !url;
  openBtn.addEventListener('click', () => {
    if (!url) {
      showToast('No web URL for this link', 'error');
      return;
    }
    openExternalGitUrl(url);
  });
  actions.appendChild(openBtn);

  if (options.canSync) {
    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'issues-btn issues-detail__git-open';
    syncBtn.textContent = 'Sync';
    syncBtn.title = 'Sync this issue with GitHub';
    bindGithubSyncButton(syncBtn, issue, {
      idleLabel: 'Sync',
      conflictHost: options.conflictHost,
      onChanged: options.onChanged,
    });
    actions.appendChild(syncBtn);
  }

  li.appendChild(actions);
  return li;
}
