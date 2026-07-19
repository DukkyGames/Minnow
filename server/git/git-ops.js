/**
 * Git operations for /api/git (MIN-198). All ops accept optional `cwd` (defaults to workspace root).
 */

import path from 'node:path';

import { runProcess } from '../process-runner.js';
import { isGitRepository } from '../tools/git-change-stats.js';
import { invalidateRegisteredWorktreeCache } from '../worktree/allowlist.js';
import { getWorkspaceRoot, normalizeWorkspacePathKey } from '../workspace/root.js';

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
  const lockedLocal = [];
  const remote = [];

  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const isCurrent = line.startsWith('* ');
    // Git marks branches checked out in another worktree with "+ ".
    const checkedOutElsewhere = line.startsWith('+ ');
    const name = line.slice(2).trim();
    if (!name) continue;
    if (isCurrent) {
      current = name;
    }
    if (name.startsWith('remotes/')) {
      remote.push(name);
    } else if (checkedOutElsewhere) {
      lockedLocal.push(name);
    } else {
      local.push(name);
    }
  }

  return { current, local, lockedLocal, remote };
}

/** Minnow orchestration branches (board worktrees) — not user checkout targets. */
export function isMinnowBoardBranch(name) {
  return typeof name === 'string' && name.startsWith('minnow/board/');
}

/**
 * Branches checked out in worktrees other than `mainRepoRoot`.
 * @param {string} porcelain `git worktree list --porcelain`
 * @param {string} mainRepoRoot
 */
export function parseWorktreeLockedBranches(porcelain, mainRepoRoot) {
  const locked = new Set();
  const norm = (p) =>
    String(p ?? '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const main = norm(mainRepoRoot);
  let currentPath = '';

  for (const rawLine of String(porcelain ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
      continue;
    }
    if (!line.startsWith('branch ') || !currentPath) continue;
    const branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    if (norm(currentPath) !== main) {
      locked.add(branch);
    }
  }

  return locked;
}

/**
 * Local branches suitable for user-facing checkout pickers.
 * @param {string[]} local
 * @param {Set<string>} [lockedElsewhere]
 */
export function filterUserFacingBranches(local, lockedElsewhere = new Set()) {
  return local.filter((b) => !isMinnowBoardBranch(b) && !lockedElsewhere.has(b));
}

/**
 * Parse one git log line.
 * Preferred format is %x1f-delimited (`%H%x1f%P%x1f%s%x1f%an%x1f%ar%x1f%D`),
 * which is unambiguous for any subject/author. Legacy space-separated lines
 * (`%H %P %s %an %ar %D`) are still parsed; there the author is taken as the
 * final token before the relative time, so multi-word authors lose tokens
 * into the subject.
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

const LOG_FIELD_SEP = '\u001f';

export function parseLogLine(line) {
  const trimmed = String(line ?? '').trimEnd();
  if (!trimmed || trimmed.length < 42) return null;

  if (trimmed.includes(LOG_FIELD_SEP)) {
    const [hash, parentsField, subject, author, relativeTime, refsField] =
      trimmed.split(LOG_FIELD_SEP);
    if (!/^[0-9a-f]{40}$/.test(hash ?? '')) return null;
    return {
      hash,
      parents: (parentsField ?? '').split(' ').filter(Boolean),
      subject: (subject ?? '').trim(),
      author: (author ?? '').trim(),
      relativeTime: (relativeTime ?? '').trim(),
      refs: splitLogRefList(refsField ?? ''),
    };
  }

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

/** `git log --topo-order --format=<%x1f-delimited> --exclude=refs/stash --all -n <count>` */
export async function log({ cwd, count = 10 } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const n = Math.max(1, Math.min(Number(count) || 10, 200));
  const result = await git(
    [
      'log',
      '--topo-order',
      '--format=%H%x1f%P%x1f%s%x1f%an%x1f%ar%x1f%D',
      '--exclude=refs/stash',
      '--all',
      '-n',
      String(n),
    ],
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

  const rootResult = await git(['rev-parse', '--show-toplevel'], repo.cwd);
  const repoRoot = (rootResult.stdout ?? '').trim();

  const [branchResult, wtResult] = await Promise.all([
    git(['branch', '-a'], repo.cwd),
    git(['worktree', 'list', '--porcelain'], repo.cwd),
  ]);
  if (branchResult.code !== 0) {
    return { ok: false, error: processError(branchResult) };
  }

  const parsed = parseBranchList(branchResult.stdout);
  const lockedElsewhere =
    repoRoot && wtResult.code === 0
      ? parseWorktreeLockedBranches(wtResult.stdout ?? '', repoRoot)
      : new Set();
  parsed.local = filterUserFacingBranches(parsed.local, lockedElsewhere);
  parsed.lockedLocal = (parsed.lockedLocal ?? []).filter((b) => !isMinnowBoardBranch(b));

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
  if (name === 'main' || name === 'master') {
    return { ok: false, error: 'Cannot delete the main or master branch' };
  }

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

  invalidateRegisteredWorktreeCache();
  return { ok: true, path: targetPath, branch: branchName };
}

/**
 * Principal worktree for the repo (first entry in `git worktree list --porcelain`).
 * Linked worktrees must not be compared via `rev-parse --show-toplevel` from their cwd —
 * that returns the linked path, not the main worktree.
 * @param {string} repoCwd
 * @returns {Promise<string | null>}
 */
async function resolveMainWorktreePath(repoCwd) {
  const result = await git(['worktree', 'list', '--porcelain'], repoCwd);
  if (result.code !== 0) return null;
  for (const rawLine of String(result.stdout ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('worktree ')) {
      return line.slice('worktree '.length).trim();
    }
  }
  return null;
}

/** `git worktree remove [--force] <path>` */
export async function worktreeRemove({ cwd, path: worktreePath, force } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!worktreePath || typeof worktreePath !== 'string' || !worktreePath.trim()) {
    return { ok: false, error: 'path is required' };
  }

  const targetPath = worktreePath.trim();
  const mainWorktreePath = await resolveMainWorktreePath(repo.cwd);
  if (
    mainWorktreePath &&
    normalizeWorkspacePathKey(targetPath) === normalizeWorkspacePathKey(mainWorktreePath)
  ) {
    return { ok: false, error: 'Cannot remove the main worktree' };
  }

  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(targetPath);

  // Run from the principal worktree so removal works when cwd is the linked worktree.
  const gitCwd = mainWorktreePath ?? repo.cwd;
  const result = await git(args, gitCwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  invalidateRegisteredWorktreeCache();
  return { ok: true };
}

/** `git checkout [-b] <branch> [<startPoint>]` or `git checkout --detach <sha>` */
export async function checkout({ cwd, branch, create, startPoint } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    return { ok: false, error: 'branch is required' };
  }

  const args = create
    ? ['checkout', '-b', branch.trim()]
    : ['checkout', branch.trim()];
  if (create && startPoint && typeof startPoint === 'string' && startPoint.trim()) {
    args.push(startPoint.trim());
  }
  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git checkout --detach <sha>` */
export async function checkoutDetach({ cwd, sha } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!sha || typeof sha !== 'string' || !sha.trim()) {
    return { ok: false, error: 'sha is required' };
  }

  const result = await git(['checkout', '--detach', sha.trim()], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git tag <name> <sha>` */
export async function createTag({ cwd, name, sha } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'name is required' };
  }
  if (!sha || typeof sha !== 'string' || !sha.trim()) {
    return { ok: false, error: 'sha is required' };
  }

  const result = await git(['tag', name.trim(), sha.trim()], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git remote get-url origin` */
export async function remoteUrl({ cwd } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const result = await git(['remote', 'get-url', 'origin'], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  const url = (result.stdout ?? '').trim();
  if (!url) {
    return { ok: false, error: 'No origin remote configured' };
  }

  return { ok: true, url };
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

/** Detect merge/rebase/cherry-pick conflict from git stderr/stdout. */
function isGitConflictOutput(text) {
  const lower = String(text ?? '').toLowerCase();
  return (
    lower.includes('conflict') ||
    lower.includes('fix conflicts') ||
    lower.includes('unmerged paths')
  );
}

/** `git merge <branch> [--no-ff]` or `--abort` */
export async function merge({ cwd, branch, noFf, abort } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  if (abort) {
    const result = await git(['merge', '--abort'], repo.cwd);
    if (result.code !== 0) {
      return { ok: false, error: processError(result) };
    }
    return { ok: true, stdout: (result.stdout ?? '').trim() };
  }

  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    return { ok: false, error: 'branch is required' };
  }

  const args = ['merge', branch.trim()];
  if (noFf) args.push('--no-ff');

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    const err = processError(result);
    return { ok: false, error: err, conflict: isGitConflictOutput(err) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** `git rebase <onto>` or `--abort` / `--continue` */
export async function rebase({ cwd, onto, abort, continue: cont } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const args = ['rebase'];
  if (abort) {
    args.push('--abort');
  } else if (cont) {
    args.push('--continue');
  } else {
    if (!onto || typeof onto !== 'string' || !onto.trim()) {
      return { ok: false, error: 'onto is required' };
    }
    args.push(onto.trim());
  }

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    const err = processError(result);
    return { ok: false, error: err, conflict: isGitConflictOutput(err) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** `git stash list` */
export async function stashList({ cwd } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const result = await git(['stash', 'list'], repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  const entries = String(result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return { ok: true, stashes: entries };
}

/** `git stash push [-m msg] [-- paths]` */
export async function stashPush({ cwd, message, paths } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const args = ['stash', 'push'];
  if (message && String(message).trim()) {
    args.push('-m', String(message).trim());
  }
  if (Array.isArray(paths) && paths.length > 0) {
    args.push('--', ...paths.map((p) => String(p)));
  }

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** `git stash pop [stash@{n}]` */
export async function stashPop({ cwd, index } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const ref = typeof index === 'number' && index >= 0 ? `stash@{${index}}` : undefined;
  const args = ref ? ['stash', 'pop', ref] : ['stash', 'pop'];

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    const err = processError(result);
    return { ok: false, error: err, conflict: isGitConflictOutput(err) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** `git stash apply [stash@{n}]` */
export async function stashApply({ cwd, index } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const ref = typeof index === 'number' && index >= 0 ? `stash@{${index}}` : undefined;
  const args = ref ? ['stash', 'apply', ref] : ['stash', 'apply'];

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    const err = processError(result);
    return { ok: false, error: err, conflict: isGitConflictOutput(err) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}

/** `git stash drop [stash@{n}]` */
export async function stashDrop({ cwd, index } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const ref = typeof index === 'number' && index >= 0 ? `stash@{${index}}` : undefined;
  const args = ref ? ['stash', 'drop', ref] : ['stash', 'drop'];

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result) };
  }

  return { ok: true };
}

/** `git cherry-pick <sha>` or `--abort` / `--continue` */
export async function cherryPick({ cwd, sha, abort, continue: cont } = {}) {
  const repo = await requireGitRepo(cwd);
  if (!repo.ok) return repo;

  const args = ['cherry-pick'];
  if (abort) {
    args.push('--abort');
  } else if (cont) {
    args.push('--continue');
  } else {
    if (!sha || typeof sha !== 'string' || !sha.trim()) {
      return { ok: false, error: 'sha is required' };
    }
    args.push(sha.trim());
  }

  const result = await git(args, repo.cwd);
  if (result.code !== 0) {
    const err = processError(result);
    return { ok: false, error: err, conflict: isGitConflictOutput(err) };
  }

  return { ok: true, stdout: (result.stdout ?? '').trim() };
}
