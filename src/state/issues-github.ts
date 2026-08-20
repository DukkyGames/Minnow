/**
 * GitHub sync for Issues: the side of it that touches the network and the store.
 *
 * The decisions live in `issues/github-sync-plan.ts` and are pure. This module
 * only carries them out, which is why it never contains a "who wins" branch —
 * if you find yourself adding one here, it belongs in the planner where it can
 * be tested.
 *
 * Phase 5 of `documentation/plans/issues-app-v2.md`.
 */

import {
  ISSUES_GITHUB_MODES,
  nextGithubLink,
  normalizeGithubMode,
  planIssueSync,
  type IssuesGithubMode,
  type RemoteIssueSnapshot,
  type SyncAction,
  type SyncFields,
} from '../issues/github-sync-plan';
import {
  addIssue,
  appendIssueLinks,
  findIssueById,
  listIssues,
  requireIssueStatusForRole,
  scheduleSaveIssues,
  updateIssue,
} from './issues-store';
import { isClosedStatus } from '../issues/taxonomy';
import { getIssuesTaxonomySync } from './issues-taxonomy-store';
import { getLocalServerAvailable } from '../tools/client';
import { getWorkspacePath } from './workspace';

const MODE_STORAGE_KEY = 'minnow.issues.github.mode';

let cachedMode: IssuesGithubMode | null = null;
const modeListeners = new Set<(mode: IssuesGithubMode) => void>();

/** The settings-gated sync mode. */
export function getIssuesGithubMode(): IssuesGithubMode {
  if (cachedMode) return cachedMode;
  try {
    cachedMode = normalizeGithubMode(localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    cachedMode = 'off';
  }
  return cachedMode;
}

/** Set the mode. Off is the default and always a safe answer. */
export function setIssuesGithubMode(mode: IssuesGithubMode): void {
  const next = normalizeGithubMode(mode);
  cachedMode = next;
  try {
    localStorage.setItem(MODE_STORAGE_KEY, next);
  } catch {
    /* Session-only is better than refusing to change the mode. */
  }
  for (const listener of [...modeListeners]) {
    try {
      listener(next);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Subscribe to mode changes (settings ↔ Issues chrome). */
export function subscribeIssuesGithubMode(
  listener: (mode: IssuesGithubMode) => void,
): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

/** Every valid mode, for the settings control. */
export { ISSUES_GITHUB_MODES };

interface ForgeResponse {
  ok: boolean;
  error?: string;
  issue?: RemoteIssueSnapshot;
  issues?: RemoteIssueSnapshot[];
  number?: number;
  url?: string;
  droppedLabels?: boolean;
}

async function forge(op: string, args: Record<string, unknown> = {}): Promise<ForgeResponse> {
  if (!getLocalServerAvailable()) return { ok: false, error: 'server_off' };
  try {
    const res = await fetch('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...args }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return (await res.json()) as ForgeResponse;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function localIsClosed(status: string): boolean {
  return isClosedStatus(getIssuesTaxonomySync(), status);
}

/** A conflict handed back for the user to resolve. Never resolved here. */
export interface SyncConflict {
  issueId: string;
  number: number;
  url: string;
  local: SyncFields;
  remote: SyncFields;
}

export interface SyncOutcome {
  ok: boolean;
  action: SyncAction['kind'];
  error?: string;
  conflict?: SyncConflict;
  /** Set when a label did not exist on the remote and was dropped to save the push. */
  droppedLabels?: boolean;
}

/** Read the remote counterpart of a linked issue, or null when unlinked. */
async function readRemote(issueId: string): Promise<RemoteIssueSnapshot | null> {
  const issue = findIssueById(issueId);
  const number = issue?.github?.number;
  if (!number) return null;
  const res = await forge('issueView', { number });
  return res.ok && res.issue ? res.issue : null;
}

/**
 * Sync one issue.
 *
 * Returns the conflict rather than resolving it: the brief's gate is that
 * mirror mode never silently overwrites, and a function that could choose a
 * winner here would eventually be asked to.
 */
export async function syncIssueWithGithub(issueId: string): Promise<SyncOutcome> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, action: 'noop', error: 'Issue not found' };

  const mode = getIssuesGithubMode();
  const remote = await readRemote(issueId);
  const action = planIssueSync({
    mode,
    issue,
    isClosed: localIsClosed(issue.status),
    remote,
  });

  switch (action.kind) {
    case 'noop':
      return { ok: true, action: 'noop', error: action.reason };

    case 'create': {
      const res = await forge('issueCreate', {
        title: issue.title,
        body: issue.description,
        labels: issue.labels,
      });
      if (!res.ok || !res.number) {
        return { ok: false, action: 'create', error: res.error ?? 'Could not create the issue' };
      }
      writeLink(issueId, res.number, res.url ?? '', undefined);
      return { ok: true, action: 'create', droppedLabels: res.droppedLabels };
    }

    case 'push': {
      const number = issue.github?.number;
      if (!number) return { ok: false, action: 'push', error: 'Not linked to a GitHub issue' };
      const res = await forge('issueEdit', {
        number,
        title: action.fields.title,
        body: action.fields.body,
      });
      if (!res.ok) return { ok: false, action: 'push', error: res.error };

      // State is a separate `gh` verb, so it is a second call rather than a
      // field on the edit.
      if (remote && action.fields.closed !== (remote.state === 'closed')) {
        await forge('issueState', { number, state: action.fields.closed ? 'closed' : 'open' });
      }
      const after = await readRemote(issueId);
      writeLink(issueId, number, issue.github?.url ?? '', after?.updatedAt);
      return { ok: true, action: 'push' };
    }

    case 'pull': {
      const number = issue.github?.number;
      if (!number || !remote) {
        return { ok: false, action: 'pull', error: 'Not linked to a GitHub issue' };
      }
      applyRemoteToIssue(issueId, action.fields);
      writeLink(issueId, number, issue.github?.url ?? remote.url, remote.updatedAt);
      return { ok: true, action: 'pull' };
    }

    case 'conflict':
      return {
        ok: false,
        action: 'conflict',
        conflict: {
          issueId,
          number: issue.github?.number ?? 0,
          url: issue.github?.url ?? '',
          local: action.local,
          remote: action.remote,
        },
      };

    default:
      return { ok: false, action: 'noop', error: 'Unrecognized sync action' };
  }
}

/** Resolve a conflict the user judged. Both branches then write the watermark. */
export async function resolveSyncConflict(
  conflict: SyncConflict,
  keep: 'local' | 'remote',
): Promise<SyncOutcome> {
  const issue = findIssueById(conflict.issueId);
  if (!issue) return { ok: false, action: 'noop', error: 'Issue not found' };

  if (keep === 'remote') {
    applyRemoteToIssue(conflict.issueId, conflict.remote);
    const after = await readRemote(conflict.issueId);
    writeLink(conflict.issueId, conflict.number, conflict.url, after?.updatedAt);
    return { ok: true, action: 'pull' };
  }

  const res = await forge('issueEdit', {
    number: conflict.number,
    title: conflict.local.title,
    body: conflict.local.body,
  });
  if (!res.ok) return { ok: false, action: 'push', error: res.error };
  if (conflict.local.closed !== conflict.remote.closed) {
    await forge('issueState', {
      number: conflict.number,
      state: conflict.local.closed ? 'closed' : 'open',
    });
  }
  const after = await readRemote(conflict.issueId);
  writeLink(conflict.issueId, conflict.number, conflict.url, after?.updatedAt);
  return { ok: true, action: 'push' };
}

function applyRemoteToIssue(issueId: string, fields: SyncFields): void {
  const status = fields.closed
    ? requireIssueStatusForRole('done')
    : findIssueById(issueId)?.status;
  updateIssue(issueId, {
    title: fields.title,
    description: fields.body,
    labels: fields.labels,
    ...(status ? { status } : {}),
  });
}

function writeLink(
  issueId: string,
  number: number,
  url: string,
  remoteUpdatedAt: number | undefined,
): void {
  const issue = findIssueById(issueId);
  if (!issue) return;
  issue.github = nextGithubLink({
    previous: issue.github,
    number,
    url,
    localUpdatedAt: issue.updatedAt,
    remoteUpdatedAt,
    now: Date.now(),
  });
  // Also a visible chip, so the linkage shows in the Git section without the
  // detail panel knowing about the sync layer.
  appendIssueLinks(issueId, {
    gitLinks: [{ kind: 'github-issue', ref: `#${number}`, url }],
  });
  scheduleSaveIssues();
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  imported: number;
  skipped: number;
}

/**
 * Import remote issues that are not already linked.
 *
 * Imported cards land in the Triage lane (`source: 'github'`, no `triagedAt`),
 * which is the whole reason Triage keys off source rather than status: a
 * hundred imported issues must not silently become a hundred backlog items.
 */
export async function importGithubIssues(options?: {
  state?: 'open' | 'closed' | 'all';
  limit?: number;
}): Promise<ImportResult> {
  if (getIssuesGithubMode() === 'off') {
    return { ok: false, error: 'GitHub sync is off', imported: 0, skipped: 0 };
  }

  const res = await forge('issueList', {
    state: options?.state ?? 'open',
    limit: options?.limit ?? 100,
  });
  if (!res.ok || !Array.isArray(res.issues)) {
    return { ok: false, error: res.error ?? 'Could not list issues', imported: 0, skipped: 0 };
  }

  const linked = new Set(
    listIssues()
      .map((issue) => issue.github?.number)
      .filter((n): n is number => typeof n === 'number'),
  );

  let imported = 0;
  let skipped = 0;
  const workspacePath = getWorkspacePath();

  for (const remote of res.issues) {
    if (linked.has(remote.number)) {
      skipped += 1;
      continue;
    }
    const card = addIssue({
      title: remote.title || `GitHub #${remote.number}`,
      description: remote.body,
      labels: remote.labels,
      workspacePath,
      source: 'github',
      ...(remote.state === 'closed' ? { status: requireIssueStatusForRole('done') } : {}),
    });
    updateIssue(card.id, { githubSync: true });
    writeLink(card.id, remote.number, remote.url, remote.updatedAt);
    imported += 1;
  }

  if (imported > 0) scheduleSaveIssues();
  return { ok: true, imported, skipped };
}

/** Sync every eligible issue; returns the conflicts for the user to resolve. */
export async function syncAllIssuesWithGithub(): Promise<{
  synced: number;
  conflicts: SyncConflict[];
  errors: string[];
}> {
  const conflicts: SyncConflict[] = [];
  const errors: string[] = [];
  let synced = 0;

  const mode = getIssuesGithubMode();
  if (mode === 'off') return { synced, conflicts, errors };

  for (const issue of listIssues()) {
    if (mode === 'link' && !issue.githubSync) continue;
    const outcome = await syncIssueWithGithub(issue.id);
    if (outcome.conflict) conflicts.push(outcome.conflict);
    else if (outcome.ok && outcome.action !== 'noop') synced += 1;
    else if (!outcome.ok && outcome.error && outcome.error !== 'server_off') {
      errors.push(`${issue.id}: ${outcome.error}`);
    }
  }
  return { synced, conflicts, errors };
}

/** Reset cached settings (tests). */
export function resetIssuesGithubForTests(): void {
  cachedMode = null;
  modeListeners.clear();
}
