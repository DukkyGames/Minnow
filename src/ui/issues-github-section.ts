/**
 * GitHub sync controls on the issue peek panel.
 *
 * Absent, not disabled. §8 asks for that explicitly and the reason is that a
 * greyed-out "Sync with GitHub" on a workspace with no GitHub remote is a
 * question the user cannot answer. With the mode Off, this renders nothing at
 * all — the same way `detectGhAvailable()` already gates the PR button.
 *
 * Conflict resolution is inline and explicit: both versions, side by side, and
 * two buttons. Nothing here picks a winner.
 *
 * Phase 5 of `documentation/plans/issues-app-v2.md`.
 */

import {
  getIssuesGithubMode,
  resolveSyncConflict,
  syncIssueWithGithub,
  type SyncConflict,
} from '../state/issues-github';
import { scheduleSaveIssues, updateIssue } from '../state/issues-store';
import type { IssueCard } from '../types';
import { showToast } from './toast';

/** Called after any change so the panel re-renders from store state. */
export type GithubSectionChanged = () => void;

function truncate(text: string, max = 400): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

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
  head.textContent = `Both sides changed since the last sync. Pick which to keep — neither is overwritten until you do.`;
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'issues-github__conflict-grid';

  const side = (label: string, fields: SyncConflict['local'], keep: 'local' | 'remote'): HTMLElement => {
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
      void resolveSyncConflict(conflict, keep).then((outcome) => {
        if (!outcome.ok) {
          showToast(outcome.error ?? 'Could not resolve the conflict', 'error');
          keepBtn.disabled = false;
          return;
        }
        showToast(keep === 'local' ? 'Pushed your version' : 'Took the GitHub version', 'success');
        onChanged();
      });
    });
    column.appendChild(keepBtn);
    return column;
  };

  grid.append(
    side('Yours', conflict.local, 'local'),
    side('GitHub', conflict.remote, 'remote'),
  );
  wrap.appendChild(grid);
  return wrap;
}

/**
 * Render the section into a peek-panel section body.
 *
 * Returns false when nothing was rendered, so the caller can skip appending an
 * empty section rather than leaving a titled void.
 */
export function renderIssueGithubSection(
  body: HTMLElement,
  issue: IssueCard,
  onChanged: GithubSectionChanged,
): boolean {
  const mode = getIssuesGithubMode();
  if (mode === 'off') return false;

  const link = issue.github;

  const status = document.createElement('p');
  status.className = 'issues-detail__empty';
  if (link) {
    status.textContent = `Linked to #${link.number}.`;
    body.appendChild(status);
  }

  if (link?.url) {
    const open = document.createElement('a');
    open.className = 'issues-github__link';
    open.href = link.url;
    open.target = '_blank';
    open.rel = 'noreferrer';
    // gh CLI tone: terse, factual, states not decorations.
    open.textContent = `#${link.number} · github`;
    body.appendChild(open);
  }

  const controls = document.createElement('div');
  controls.className = 'issues-detail__add-code';

  // The per-issue flag only means anything in Link + push; in mirror mode the
  // mode itself is the opt-in, so showing a second switch would imply a
  // distinction that does not exist.
  if (mode === 'link') {
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'issues-github__toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = issue.githubSync === true;
    toggle.addEventListener('change', () => {
      updateIssue(issue.id, { githubSync: toggle.checked });
      scheduleSaveIssues();
      onChanged();
    });
    toggleLabel.append(toggle, document.createTextNode(' Sync this issue'));
    controls.appendChild(toggleLabel);
  }

  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'issues-btn';
  syncBtn.textContent = link ? 'Sync now' : 'Push to GitHub';
  syncBtn.addEventListener('click', () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing…';
    void syncIssueWithGithub(issue.id).then((outcome) => {
      syncBtn.disabled = false;
      if (outcome.conflict) {
        body.appendChild(buildConflictPane(outcome.conflict, onChanged));
        syncBtn.textContent = 'Sync now';
        return;
      }
      if (!outcome.ok) {
        showToast(outcome.error ?? 'Sync failed', 'error');
        syncBtn.textContent = link ? 'Sync now' : 'Push to GitHub';
        return;
      }
      if (outcome.droppedLabels) {
        showToast('Created on GitHub. Some labels do not exist there and were dropped.', 'success');
      } else if (outcome.action === 'noop') {
        showToast(outcome.error ?? 'Already in sync', 'success');
      } else {
        showToast(outcome.action === 'pull' ? 'Took the GitHub version' : 'Pushed to GitHub', 'success');
      }
      onChanged();
    });
  });
  controls.appendChild(syncBtn);
  body.appendChild(controls);

  return true;
}
