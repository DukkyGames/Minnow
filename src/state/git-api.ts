/**
 * Client wrappers for /api/git server ops (MIN-198 Git Support).
 */

import { isLocalServerAvailable } from '../tools/config.ts';
import { reportBackgroundError } from '../boot/report-background-error.ts';

export interface GitFileEntry {
  path: string;
  status: string;
}

export interface GitCommitEntry {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  relativeTime: string;
  refs: string[];
}

export interface GitOpResult {
  ok: boolean;
  error?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  staged?: GitFileEntry[];
  unstaged?: GitFileEntry[];
  untracked?: GitFileEntry[];
  patch?: string;
  sha?: string;
  stdout?: string;
  commits?: GitCommitEntry[];
  current?: string;
  local?: string[];
  remote?: string[];
  stat?: string;
}

async function postGit(
  op: string,
  args: Record<string, unknown> = {},
): Promise<GitOpResult> {
  if (!isLocalServerAvailable()) {
    return { ok: false, error: 'server_off' };
  }
  try {
    const res = await fetch('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...args }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return (await res.json()) as GitOpResult;
  } catch (err) {
    reportBackgroundError('git-op', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function gitStatus(cwd?: string): Promise<GitOpResult> {
  return postGit('status', cwd ? { cwd } : {});
}

export function gitDiff(input?: {
  cwd?: string;
  cached?: boolean;
  path?: string;
}): Promise<GitOpResult> {
  return postGit('diff', input ?? {});
}

export function gitStage(input: {
  paths: string[];
  cwd?: string;
}): Promise<GitOpResult> {
  return postGit('stage', input);
}

export function gitStageAll(cwd?: string): Promise<GitOpResult> {
  return postGit('stageAll', cwd ? { cwd } : {});
}

export function gitUnstage(input: {
  paths: string[];
  cwd?: string;
}): Promise<GitOpResult> {
  return postGit('unstage', input);
}

export function gitDiscard(input: {
  paths: string[];
  cwd?: string;
}): Promise<GitOpResult> {
  return postGit('discard', input);
}

export function gitCommit(input: {
  message: string;
  cwd?: string;
}): Promise<GitOpResult> {
  return postGit('commit', input);
}

export function gitPush(input?: {
  cwd?: string;
  setUpstream?: boolean;
  branch?: string;
}): Promise<GitOpResult> {
  return postGit('push', input ?? {});
}

export function gitPull(cwd?: string): Promise<GitOpResult> {
  return postGit('pull', cwd ? { cwd } : {});
}

export function gitFetch(cwd?: string): Promise<GitOpResult> {
  return postGit('fetch', cwd ? { cwd } : {});
}

export function gitLog(input?: {
  cwd?: string;
  count?: number;
}): Promise<GitOpResult> {
  return postGit('log', input ?? {});
}

export function gitBranches(cwd?: string): Promise<GitOpResult> {
  return postGit('branches', cwd ? { cwd } : {});
}

export function gitCheckout(input: {
  branch: string;
  create?: boolean;
  cwd?: string;
}): Promise<GitOpResult> {
  return postGit('checkout', input);
}

export function gitShow(input: {
  sha: string;
  cwd?: string;
}): Promise<GitOpResult> {
  return postGit('show', input);
}
