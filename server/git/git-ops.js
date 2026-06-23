/**
 * Git operations for /api/git (MIN-198). All ops accept optional `cwd` (defaults to workspace root).
 */

import path from 'node:path';

import { runProcess } from '../process-runner.js';
import { isGitRepository } from '../tools/git-change-stats.js';
import { getWorkspaceRoot } from '../workspace/root.js';

const GIT_TIMEOUT_MS = 120_000;

/** Resolve working directory for git commands. */
function resolveCwd(cwd) {
  return cwd && String(cwd).trim() ? String(cwd).trim() : getWorkspaceRoot();
}

/** Run git in cwd; returns runProcess result. */
async function git(args, cwd) {
  return runProcess('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
}

/** Combine stdout/stderr for error messages. */
function processError(result) {
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return text || `git exited with code ${result.code}`;
}

/** Fail fast when cwd is not inside a git work tree. */
async function requireGitRepo(cwd) {
  const root = resolveCwd(cwd);
  if (!(await isGitRepository(root))) {
    return { ok: false, error: 'Not a git repository' };
  }
  return { ok: true, cwd: root };
}

/**
 * Parse porcelain v1 status lines into branch metadata and file buckets.
 * @param {string} text
 */
export function parsePorcelainStatus(text) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  let branch = '';
  let ahead = 0;
  let behind = 0;

  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.startsWith('##')) {
      const header = line.slice(3).trim();
      const branchPart = header.split('...')[0]?.trim() ?? '';
      branch =
        branchPart === 'HEAD (no branch)' || branchPart.startsWith('HEAD (')
          ? 'HEAD'
          : branchPart;

      const bracket = header.match(/\[(.+)\]/);
      if (bracket) {
        const aheadMatch = bracket[1].match(/ahead\s+(\d+)/);
        const behindMatch = bracket[1].match(/behind\s+(\d+)/);
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
        behind = behindMatch ? Number(behindMatch[1]) : 0;
      }
      continue;
    }

    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    let path = line.slice(3);
    let status = y !== ' ' ? y : x;

    if (x === '?' && y === '?') {
      untracked.push({ path, status: '?' });
      continue;
    }

    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') {
      status = 'R';
      const arrow = path.indexOf(' -> ');
      if (arrow !== -1) {
        path = path.slice(arrow + 4);
      }
    }

    const entry = { path, status };

    if (x !== ' ' && x !== '?') {
      staged.push(entry);
    }
    if (y !== ' ' && y !== '?') {
      unstaged.push(entry);
    }
  }

  return { branch, ahead, behind, staged, unstaged, untracked };
}

/**
 * Parse `git branch -a` output.
 * @param {string} text
 */
export function parseBranchList(text) {
  let current = '';
  const local = [];
  const remote = [];

  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const isCurrent = line.startsWith('* ');
    const name = (isCurrent ? line.slice(2) : line.slice(2)).trim();
    if (!name) continue;
    if (isCurrent) {
      current = name;
    }
    if (name.startsWith('remotes/')) {
      remote.push(name);
    } else {
      local.push(name);
    }
  }

  return { current, local, remote };
}

/**
 * Parse one `git log --format="%H %P %s %an %ar %D"` line.
 * Subject and author are ambiguous when both contain spaces; author is taken as the
 * final token before relative time (sufficient for typical single-token author names).
 * Refs (%D) follow the relative time and may be bare (`origin/foo, bar`) or wrapped in parens.
 * @param {string} line
 */
const LOG_RELATIVE_TIME =
  /^(.*) (\d+ seconds? ago|\d+ minutes? ago|\d+ hours? ago|\d+ days? ago|\d+ weeks? ago|\d+ months? ago|\d+ years? ago|just now)(?:\s+(.+))?\s*$/i;

/** Split a git decorator field into individual ref strings. */
function splitLogRefList(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return [];
  const inner =
    trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

export function parseLogLine(line) {
  const trimmed = String(line ?? '').trimEnd();
  if (!trimmed || trimmed.length < 42) return null;

  const hash = trimmed.slice(0, 40);
  if (!/^[0-9a-f]{40}$/.test(hash)) return null;

  let pos = 41;
  const parents = [];
  while (pos < trimmed.length) {
    const slice = trimmed.slice(pos);
    const match = slice.match(/^([0-9a-f]{40})( |$)/);
    if (!match) break;
    parents.push(match[1]);
    pos += 40;
    if (match[2] === ' ') pos += 1;
  }

  let remainder = trimmed.slice(pos).trimStart();
  let refs = [];
  let relativeTime = '';

  const timeDecorMatch = remainder.match(LOG_RELATIVE_TIME);
  if (timeDecorMatch) {
    relativeTime = timeDecorMatch[2];
    remainder = timeDecorMatch[1];
    if (timeDecorMatch[3]) {
      refs = splitLogRefList(timeDecorMatch[3]);
    }
  } else {
    // Fallback for lines that omit a relative-time token.
    const parenRefMatch = remainder.match(/^(.*) (\([^)]+\))\s*$/);
    if (parenRefMatch) {
      refs = splitLogRefList(parenRefMatch[2]);
      remainder = parenRefMatch[1];
    } else {
      const headRefMatch = remainder.match(/^(.*) (HEAD -> .+)\s*$/);
      if (headRefMatch) {
        refs = splitLogRefList(headRefMatch[2]);
        remainder = headRefMatch[1];
      }
    }
  }

  const lastSpace = remainder.lastIndexOf(' ');
  let author = '';
  let subject = remainder;
  if (lastSpace !== -1) {
    author = remainder.slice(lastSpace + 1);
    subject = remainder.slice(0, lastSpace);
  }

  return { hash, parents, subject, author, relativeTime, refs };
}

/**
 * Split combined `git show --stat --patch` output into stat summary and patch body.
 * @param {string} text
 */
export function splitShowOutput(text) {
  const raw = String(text ?? '');
  const diffIdx = raw.search(/^diff --git /m);
  if (diffIdx === -1) {
    return { stat: raw.trimEnd(), patch: '' };
  }
  const before = raw.slice(0, diffIdx).trimEnd();
  const patch = raw.slice(diffIdx).trimEnd();
  const statLines = before.split('\n');
  const statStart = statLines.findIndex((l) => /\d+ files? changed/.test(l));
  const stat = statStart === -1 ? before : statLines.slice(statStart).join('\n');
  return { stat, patch };
}

/** `git status --porcelain=v1 -b` */
export async function status({ cwd } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const result = await git(['status', '--porcelain=v1', '-b'], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  const parsed = parsePorcelainStatus(result.stdout);
  return { ok: true, ...parsed };
}

/** Unstaged tracked changes plus untracked file diffs (for commit message generation). */
async function diffWorkingTree(repoCwd) {
  const parts = [];

  const unstaged = await git(['diff'], repoCwd);
  if (unstaged.code !== 0) {
    return { ok: false, error: processError(unstaged) };
  }
  if (unstaged.stdout?.trim()) parts.push(unstaged.stdout.trimEnd());

  const statusResult = await git(['status', '--porcelain=v1'], repoCwd);
  if (statusResult.code !== 0) {
    return { ok: false, error: processError(statusResult) };
  }

  const nullDev = process.platform === 'win32' ? 'NUL' : '/dev/null';
  for (const line of (statusResult.stdout ?? '').split('\n')) {
    if (!line.startsWith('?? ')) continue;
    const filePath = line.slice(3).trim();
    if (!filePath) continue;
    const untracked = await git(['diff', '--no-index', '--', nullDev, filePath], repoCwd);
    if (untracked.stdout?.trim()) parts.push(untracked.stdout.trimEnd());
  }

  return { ok: true, patch: parts.join('\n\n') };
}

/** `git diff [--cached] [-- <path>]` or full working-tree diff when `workingTree` is true */
export async function diff({ cwd, cached, path: filePath, workingTree } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (workingTree) {
    return diffWorkingTree(repo.cwd);
  }

  const args = ['diff'];
  if (cached) args.push('--cached');
  if (filePath) args.push('--', String(filePath));

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true, patch: result.stdout ?? '' };
}

/** `git add <paths[]>` */
export async function stage({ cwd, paths } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'paths array is required' };
  }

  const result = await git(['add', ...paths.map(String)], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git add -A` */
export async function stageAll({ cwd } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const result = await git(['add', '-A'], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git reset HEAD -- <paths[]>` */
export async function unstage({ cwd, paths } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'paths array is required' };
  }

  const result = await git(['reset', 'HEAD', '--', ...paths.map(String)], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git checkout -- <paths[]>` */
export async function discard({ cwd, paths } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'paths array is required' };
  }

  const result = await git(['checkout', '--', ...paths.map(String)], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git commit -m <msg>` — auto-stages all changes when the index is empty */
export async function commit({ cwd, message } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'message is required' };
  }

  const cachedQuiet = await git(['diff', '--cached', '--quiet'], repo.cwd);
  if (cachedQuiet.code === 0) {
    const wtStatus = await git(['status', '--porcelain'], repo.cwd);
    if (!(wtStatus.stdout ?? '').trim()) {
      return { ok: false, error: 'nothing to commit, working tree clean' };
    }
    const addAll = await git(['add', '-A'], repo.cwd);
    if (addAll.code !== 0) {
      return { ok: false, error: processError(addAll) };
    }
  }

  const result = await git(['commit', '-m', message], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  const shaResult = await git(['rev-parse', 'HEAD'], repo.cwd);
  if (shaResult.code !== 0) {
    return { ok: false, error: processError(shaResult) };
  }

  return { ok: true, sha: (shaResult.stdout ?? '').trim() };
}

/** `git push [--set-upstream origin <branch>]` */
export async function push({ cwd, setUpstream, branch } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const args = ['push'];
  if (setUpstream) {
    if (!branch || typeof branch !== 'string' || !branch.trim()) {
      return { ok: false, error: 'branch is required when setUpstream is true' };
    }
    args.push('--set-upstream', 'origin', branch.trim());
  }

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** `git pull` */
export async function pull({ cwd } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const result = await git(['pull'], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** `git fetch --all` */
export async function fetch({ cwd } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const result = await git(['fetch', '--all'], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git log --format="%H %P %s %an %ar %D" --all -n <count>` */
export async function log({ cwd, count = 10 } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const n = Math.max(1, Math.min(Number(count) || 10, 200));
  const result = await git(
    ['log', '--format=%H %P %s %an %ar %D', '--all', '-n', String(n)],
    repo.cwd,
  );
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  const commits = String(result.stdout ?? '')
    .split('\n')
    .map((line) => parseLogLine(line))
    .filter(Boolean);

  return { ok: true, commits };
}

/** `git branch -a` */
export async function branches({ cwd } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const result = await git(['branch', '-a'], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  const parsed = parseBranchList(result.stdout);
  return { ok: true, ...parsed };
}

/** `git branch [-d|-D] <branch>` */
export async function deleteBranch({ cwd, branch, force } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    return { ok: false, error: 'branch is required' };
  }

  const name = branch.trim();
  const currentResult = await git(['branch', '--show-current'], repo.cwd);
  if (currentResult.code === 0 && (currentResult.stdout ?? '').trim() === name) {
    return { ok: false, error: 'Cannot delete the current branch' };
  }

  const args = ['branch', force ? '-D' : '-d', name];
  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git worktree add [-b <branch>] <path> [<start-point>]` */
export async function worktreeAdd({ cwd, branch, path: worktreePath, baseRef } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    return { ok: false, error: 'branch is required' };
  }

  const branchName = branch.trim();
  const rootResult = await git(['rev-parse', '--show-toplevel'], repo.cwd);
  if (rootResult.code !== 0) {
    return { ok: false, error: processError(rootResult) };
  }
  const repoRoot = (rootResult.stdout ?? '').trim();

  let targetPath =
    typeof worktreePath === 'string' && worktreePath.trim()
      ? worktreePath.trim()
      : path.join(repoRoot, '.worktrees', branchName.replace(/[^a-zA-Z0-9._-]+/g, '-'));

  const args = ['worktree', 'add', '-b', branchName, targetPath];
  if (baseRef && String(baseRef).trim()) {
    args.push(String(baseRef).trim());
  }

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true, path: targetPath, branch: branchName };
}

/** `git worktree remove [--force] <path>` */
export async function worktreeRemove({ cwd, path: worktreePath, force } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!worktreePath || typeof worktreePath !== 'string' || !worktreePath.trim()) {
    return { ok: false, error: 'path is required' };
  }

  const targetPath = worktreePath.trim();
  const rootResult = await git(['rev-parse', '--show-toplevel'], repo.cwd);
  if (rootResult.code !== 0) {
    return { ok: false, error: processError(rootResult) };
  }
  const repoRoot = (rootResult.stdout ?? '').trim();
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm(targetPath) === norm(repoRoot)) {
    return { ok: false, error: 'Cannot remove the main worktree' };
  }

  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(targetPath);

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git checkout [-b] <branch>` */
export async function checkout({ cwd, branch, create } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    return { ok: false, error: 'branch is required' };
  }

  const args = create
    ? ['checkout', '-b', branch.trim()]
    : ['checkout', branch.trim()];
  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git show --stat --patch <sha>` */
export async function show({ cwd, sha } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!sha || typeof sha !== 'string' || !sha.trim()) {
    return { ok: false, error: 'sha is required' };
  }

  const result = await git(['show', '--stat', '--patch', sha.trim()], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  const { stat, patch } = splitShowOutput(result.stdout);
  return { ok: true, patch, stat };
}
