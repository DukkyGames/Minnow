/**
 * What syncing one issue with GitHub should do — decided before anything runs.
 *
 * This is the whole "mirror mode never silently loses an edit" guarantee, and
 * it is deliberately a pure function so it can be tested exhaustively rather
 * than hoped about. The rule is one sentence: an edit on both sides since the
 * last watermark is a **conflict the user resolves**, never a race the last
 * writer wins.
 *
 * The three modes:
 *
 * - **off** — nothing is ever contacted.
 * - **link** — local is the source of truth. Local changes push; remote changes
 *   are read for display but never overwrite local text. Per-issue opt-in.
 * - **mirror** — both directions, with conflicts surfaced.
 *
 * Phase 5 of `documentation/plans/issues-app-v2.md`.
 */

import type { IssueCard, IssueGithubLink } from '../types';

/** Settings-gated sync mode. */
export type IssuesGithubMode = 'off' | 'link' | 'mirror';

export const ISSUES_GITHUB_MODES: readonly IssuesGithubMode[] = ['off', 'link', 'mirror'];

/** Human labels for the settings control. */
export const ISSUES_GITHUB_MODE_LABELS: Record<IssuesGithubMode, string> = {
  off: 'Off',
  link: 'Link + push',
  mirror: 'Two-way mirror',
};

/** The remote fields sync compares against. */
export interface RemoteIssueSnapshot {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  labels: string[];
  updatedAt?: number;
}

export type SyncAction =
  /** Nothing to do. */
  | { kind: 'noop'; reason: string }
  /** Create the issue on GitHub. */
  | { kind: 'create' }
  /** Overwrite the remote from local. */
  | { kind: 'push'; fields: SyncFields }
  /** Overwrite local from the remote. */
  | { kind: 'pull'; fields: SyncFields }
  /** Both sides changed. The user picks. */
  | { kind: 'conflict'; local: SyncFields; remote: SyncFields };

/** The fields that participate in sync. Everything else is local-only. */
export interface SyncFields {
  title: string;
  body: string;
  closed: boolean;
  labels: string[];
}

function localFields(issue: IssueCard, isClosed: boolean): SyncFields {
  return {
    title: issue.title,
    body: issue.description,
    closed: isClosed,
    labels: [...issue.labels],
  };
}

function remoteFields(remote: RemoteIssueSnapshot): SyncFields {
  return {
    title: remote.title,
    body: remote.body,
    closed: remote.state === 'closed',
    labels: [...remote.labels],
  };
}

/** True when the two sides carry the same synced content. */
export function syncFieldsEqual(a: SyncFields, b: SyncFields): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    a.body.trim() === b.body.trim() &&
    a.closed === b.closed &&
    a.labels.length === b.labels.length &&
    a.labels.every((label) => b.labels.includes(label))
  );
}

export interface PlanSyncInput {
  mode: IssuesGithubMode;
  issue: IssueCard;
  /** Whether the local status maps to closed. Taxonomy lives outside this module. */
  isClosed: boolean;
  /** Remote record, or null when the issue has never been pushed. */
  remote: RemoteIssueSnapshot | null;
}

/**
 * Decide the single action for one issue.
 *
 * Reads only timestamps and content — no clock, no I/O — so every branch is
 * reachable from a test.
 */
export function planIssueSync(input: PlanSyncInput): SyncAction {
  const { mode, issue, remote, isClosed } = input;

  if (mode === 'off') return { kind: 'noop', reason: 'GitHub sync is off' };

  if (mode === 'link' && !issue.githubSync) {
    return { kind: 'noop', reason: 'This issue is not opted into sync' };
  }

  const link = issue.github;
  const local = localFields(issue, isClosed);

  if (!link || !remote) {
    if (!link) return { kind: 'create' };
    return { kind: 'noop', reason: `GitHub issue #${link.number} could not be read` };
  }

  const remoteSide = remoteFields(remote);
  if (syncFieldsEqual(local, remoteSide)) {
    return { kind: 'noop', reason: 'Already in sync' };
  }

  const localChanged = hasLocalChanged(issue, link);
  const remoteChanged = hasRemoteChanged(remote, link);

  if (mode === 'link') {
    return { kind: 'push', fields: local };
  }

  if (localChanged && remoteChanged) {
    return { kind: 'conflict', local, remote: remoteSide };
  }
  if (localChanged) return { kind: 'push', fields: local };
  if (remoteChanged) return { kind: 'pull', fields: remoteSide };

  return { kind: 'conflict', local, remote: remoteSide };
}

function hasLocalChanged(issue: IssueCard, link: IssueGithubLink): boolean {
  const baseline = link.localUpdatedAt ?? link.syncedAt;
  return issue.updatedAt > baseline;
}

function hasRemoteChanged(remote: RemoteIssueSnapshot, link: IssueGithubLink): boolean {
  if (remote.updatedAt == null) return false;
  const baseline = link.remoteUpdatedAt ?? link.syncedAt;
  return remote.updatedAt > baseline;
}

/** Build the watermark to store after a successful sync. */
export function nextGithubLink(input: {
  previous?: IssueGithubLink;
  number: number;
  url: string;
  repo?: string;
  localUpdatedAt: number;
  remoteUpdatedAt?: number;
  now: number;
}): IssueGithubLink {
  const link: IssueGithubLink = {
    number: input.number,
    url: input.url,
    syncedAt: input.now,
    localUpdatedAt: input.localUpdatedAt,
  };
  if (input.repo ?? input.previous?.repo) link.repo = input.repo ?? input.previous?.repo;
  if (input.remoteUpdatedAt != null) link.remoteUpdatedAt = input.remoteUpdatedAt;
  return link;
}

/** Coerce stored settings into a valid mode. */
export function normalizeGithubMode(raw: unknown): IssuesGithubMode {
  return typeof raw === 'string' && ISSUES_GITHUB_MODES.includes(raw as IssuesGithubMode)
    ? (raw as IssuesGithubMode)
    : 'off';
}
