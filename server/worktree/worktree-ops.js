/**
 * Git worktree operations for board task isolation (MIN-275).
 * All git runs against the active Code workspace repo; worktrees and the board
 * integration branch are created off to the side under ~/.minnow/worktrees.
 *
 * Merges run INSIDE the integration worktree so the user's main working tree and
 * checked-out branch are never touched.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../process-runner.js';
import { parseGitNumstat } from '../tools/git-change-stats.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { refreshDependencies } from './dep-install.js';
import { symlinkDependencyDirs } from './dep-symlinks.js';
import {
  getBoardWorktreesDir,
  getChatWorktreePath,
  getWorktreeSlotPath,
  isPathUnderWorktreesRoot,
} from './paths.js';

const GIT_TIMEOUT_MS = 120_000;

async function git(args, cwd = getWorkspaceRoot()) {
  return runProcess('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
}

const ok = (r) => r.code === 0;
const out = (r) => `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(branch) {
  const r = await git(['rev-parse', '--verify', '--quiet', branch]);
  return r.code === 0;
}

/** Resolve a git ref to a full commit SHA (null when missing). */
async function resolveRef(ref) {
  const r = await git(['rev-parse', '--verify', ref]);
  if (!ok(r)) return null;
  const sha = `${r.stdout ?? ''}`.trim().split(/\s/)[0];
  return sha || null;
}

/**
 * Ensure the board integration branch exists (off `baseRef`, default HEAD) and has a
 * dedicated worktree to merge into. Idempotent.
 * @param {{ boardId: string, branch: string, baseRef?: string }} input
 */
export async function ensureIntegration({ boardId, branch, baseRef }) {
  const base = (baseRef && baseRef.trim()) || 'HEAD';
  if (!(await branchExists(branch))) {
    const b = await git(['branch', branch, base]);
    if (!ok(b)) return { ok: false, stage: 'branch', output: out(b) };
  }
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
    return { ok: true, path: intPath, branch, created: false };
  } catch {
    /* needs creation */
  }
  await fs.mkdir(path.dirname(intPath), { recursive: true });
  const w = await git(['worktree', 'add', intPath, branch]);
  if (!ok(w)) return { ok: false, stage: 'worktree', path: intPath, output: out(w) };
  await symlinkDependencyDirs(getWorkspaceRoot(), intPath);
  return { ok: true, path: intPath, branch, created: true };
}

/**
 * Merge `baseRef` (normally the board integration branch) into an existing worktree.
 * No-op when the task branch already contains the integration tip.
 */
async function mergeBaseIntoWorktree(wtPath, baseRef) {
  const m = await git(['merge', baseRef, '--no-edit'], wtPath);
  if (ok(m)) return { ok: true, output: out(m) };
  await git(['merge', '--abort'], wtPath);
  return { ok: false, conflict: true, output: out(m) };
}

/**
 * Create (or attach) a task/wave worktree on its branch, based off `baseRef`
 * (normally the integration branch). When the slot already exists, merges the
 * current integration tip in so later / sequential tasks see prior task work.
 * @param {{ boardId: string, slotId: string, branch: string, baseRef?: string }} input
 */
export async function createWorktree({ boardId, slotId, branch, baseRef }) {
  const wtPath = getWorktreeSlotPath(boardId, slotId);
  const base = (baseRef && baseRef.trim()) || 'HEAD';
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  const depSource = (await pathExists(intPath)) ? intPath : getWorkspaceRoot();

  let exists = false;
  try {
    await fs.access(wtPath);
    exists = true;
  } catch {
    /* create below */
  }

  if (exists) {
    const synced = await mergeBaseIntoWorktree(wtPath, base);
    if (!synced.ok) {
      return {
        ok: false,
        conflict: synced.conflict,
        path: wtPath,
        branch,
        output: synced.output,
      };
    }
    return { ok: true, path: wtPath, branch, created: false, synced: true };
  }

  await fs.mkdir(path.dirname(wtPath), { recursive: true });
  const baseSha = await resolveRef(base);
  if (!baseSha) {
    return { ok: false, error: `invalid baseRef: ${base}`, path: wtPath, branch };
  }

  if (await branchExists(branch)) {
    const w = await git(['worktree', 'add', wtPath, branch]);
    if (!ok(w)) return { ok: false, path: wtPath, branch, output: out(w) };
    await symlinkDependencyDirs(depSource, wtPath);
    const synced = await mergeBaseIntoWorktree(wtPath, base);
    if (!synced.ok) {
      return {
        ok: false,
        conflict: synced.conflict,
        path: wtPath,
        branch,
        output: synced.output,
      };
    }
    return { ok: true, path: wtPath, branch, created: true };
  }

  const r = await git(['worktree', 'add', '-b', branch, wtPath, baseSha]);
  if (!ok(r)) return { ok: false, path: wtPath, branch, output: out(r) };
  await symlinkDependencyDirs(depSource, wtPath);
  return { ok: true, path: wtPath, branch, created: true };
}

/**
 * Merge a task/wave branch into the board integration branch, running the merge
 * inside the integration worktree. On conflict, leaves the merge in progress
 * (MERGE_HEAD + conflict stages) so a fixer can resolve and `git commit --no-edit`
 * to record a true two-parent merge.
 * @param {{ boardId: string, fromBranch: string, message?: string }} input
 */
export async function mergeIntoIntegration({ boardId, fromBranch, message }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const headBefore = await git(['rev-parse', 'HEAD'], intPath);
  const integrationSha = ok(headBefore) ? `${headBefore.stdout ?? ''}`.trim() : null;
  const args = ['merge', '--no-edit'];
  if (message && message.trim()) args.push('-m', message.trim());
  args.push(fromBranch);
  const m = await git(args, intPath);
  if (!ok(m)) {
    const diff = await git(['diff', '--name-only', '--diff-filter=U'], intPath);
    const conflictedFiles = `${diff.stdout ?? ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      ok: false,
      conflict: true,
      output: out(m),
      conflictedFiles,
      integrationSha: integrationSha || undefined,
    };
  }
  return { ok: true, output: out(m), integrationSha: integrationSha || undefined };
}

/**
 * True when a merge is actively in progress in the integration worktree
 * (MERGE_HEAD is set). Returns { ok: true, inProgress: boolean }.
 * @param {{ boardId: string }} input
 */
export async function mergeInProgress({ boardId }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const r = await git(['rev-parse', '--verify', 'MERGE_HEAD'], intPath);
  return { ok: true, inProgress: r.code === 0 };
}

/**
 * Stage all changes and commit in a task/wave worktree. No empty commits.
 * @param {{ boardId: string, slotId: string, message?: string }} input
 */
export async function commitWorktree({ boardId, slotId, message }) {
  const wtPath = getWorktreeSlotPath(boardId, slotId);
  try {
    await fs.access(wtPath);
  } catch {
    return { ok: false, error: 'worktree missing' };
  }
  const add = await git(['add', '-A'], wtPath);
  if (!ok(add)) return { ok: false, output: out(add) };
  const staged = await git(['diff', '--cached', '--quiet'], wtPath);
  if (staged.code === 0) {
    return { ok: true, committed: false };
  }
  const commitMsg = (message && message.trim()) || 'Board task commit';
  const commit = await git(['commit', '-m', commitMsg], wtPath);
  if (!ok(commit)) return { ok: false, output: out(commit) };
  return { ok: true, committed: true, output: out(commit) };
}

/**
 * Report uncommitted changes in a task/wave worktree (porcelain status).
 * @param {{ boardId: string, slotId: string }} input
 */
export async function checkWorktreeDirty({ boardId, slotId }) {
  const wtPath = getWorktreeSlotPath(boardId, slotId);
  try {
    await fs.access(wtPath);
  } catch {
    return { ok: false, error: 'worktree missing' };
  }
  const status = await git(['status', '--porcelain'], wtPath);
  const files = `${status.stdout ?? ''}${status.stderr ?? ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: true, dirty: files.length > 0, files };
}

/**
 * True when `fromBranch` is already merged into the integration branch tip.
 * @param {{ boardId: string, fromBranch: string }} input
 */
export async function checkMerged({ boardId, fromBranch }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const branch = (fromBranch && fromBranch.trim()) || '';
  if (!branch) return { ok: false, error: 'fromBranch required' };
  const r = await git(['merge-base', '--is-ancestor', branch, 'HEAD'], intPath);
  return { ok: true, merged: r.code === 0 };
}

/**
 * Reset the integration worktree to a known-good tip: abort any in-progress merge,
 * hard-reset to `sha`, and remove untracked files. Used when a merge fixer fails.
 * @param {{ boardId: string, sha: string }} input
 */
export async function restoreIntegration({ boardId, sha }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const target = (sha && sha.trim()) || '';
  if (!target) return { ok: false, error: 'sha required' };
  const resolved = await resolveRef(target);
  if (!resolved) return { ok: false, error: `invalid sha: ${target}` };

  await git(['merge', '--abort'], intPath);
  const reset = await git(['reset', '--hard', resolved], intPath);
  if (!ok(reset)) return { ok: false, output: out(reset) };
  await git(['clean', '-fd'], intPath);
  return { ok: true, sha: resolved, output: out(reset) };
}

/**
 * Structural checks after an integration merge (no build/typecheck).
 * @param {{ boardId: string, fromBranch: string }} input
 */
export async function verifyIntegrationMerge({ boardId, fromBranch }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const branch = (fromBranch && fromBranch.trim()) || '';
  if (!branch) return { ok: false, error: 'fromBranch required' };

  const reasons = [];

  const ancestor = await git(['merge-base', '--is-ancestor', branch, 'HEAD'], intPath);
  if (ancestor.code !== 0) {
    reasons.push(`${branch} is not an ancestor of integration HEAD`);
  }

  const markers = await git(
    ['grep', '-lE', '^(<{7}|={7}|>{7})( |$)', 'HEAD'],
    intPath,
  );
  if (ok(markers)) {
    const files = `${markers.stdout ?? ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (files.length) {
      reasons.push(`conflict markers remain in: ${files.join(', ')}`);
    }
  }

  const status = await git(['status', '--porcelain'], intPath);
  const dirty = `${status.stdout ?? ''}${status.stderr ?? ''}`.trim();
  if (dirty) {
    reasons.push('integration worktree has uncommitted changes');
  }

  return { ok: true, verified: reasons.length === 0, reasons };
}

/**
 * Abort an in-progress merge inside the integration worktree (best-effort).
 * @param {{ boardId: string }} input
 */
export async function abortMerge({ boardId }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const r = await git(['merge', '--abort'], intPath);
  return { ok: ok(r) || /no merge in progress/i.test(out(r)), output: out(r) };
}

/**
 * Remove a single worktree slot (force) and prune. Refuses paths outside the
 * worktrees root.
 * @param {{ boardId: string, slotId: string }} input
 */
export async function removeWorktree({ boardId, slotId }) {
  const wtPath = getWorktreeSlotPath(boardId, slotId);
  if (!isPathUnderWorktreesRoot(wtPath)) {
    return { ok: false, error: 'refusing to remove path outside the worktrees root' };
  }
  const r = await git(['worktree', 'remove', '--force', wtPath]);
  await git(['worktree', 'prune']);
  // Windows: a lingering handle can leave the dir; best-effort rm.
  try {
    await fs.rm(wtPath, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  return { ok: true, path: wtPath, output: out(r) };
}

/**
 * Remove all worktrees for a board (on completion / delete) and the board dir.
 * @param {{ boardId: string, includeIntegration?: boolean }} input
 */
export async function cleanupBoardWorktrees({ boardId, includeIntegration = false }) {
  const dir = getBoardWorktreesDir(boardId);
  if (!isPathUnderWorktreesRoot(dir)) {
    return { ok: false, error: 'refusing to clean path outside the worktrees root' };
  }
  let slots = [];
  try {
    slots = await fs.readdir(dir);
  } catch {
    return { ok: true, removed: 0 };
  }
  let removed = 0;
  let keptIntegration = false;
  for (const slot of slots) {
    // Keep integration until the user lands work in the workspace (MIN-208 finish dashboard).
    if (!includeIntegration && slot === 'integration') {
      keptIntegration = true;
      continue;
    }
    const r = await removeWorktree({ boardId, slotId: slot });
    if (r.ok) removed += 1;
  }
  await git(['worktree', 'prune']);
  if (!keptIntegration) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  return { ok: true, removed, keptIntegration };
}

/**
 * Diff stats for the integration worktree vs its base ref (`git diff --numstat`).
 * Also reports whether `origin` and `gh` are available for push/PR actions.
 * @param {{ boardId: string, baseRef?: string }} input
 */
export async function integrationStats({ boardId, baseRef }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const base = (baseRef && baseRef.trim()) || 'HEAD';
  const diff = await git(['diff', '--numstat', `${base}...HEAD`], intPath);
  if (!ok(diff)) return { ok: false, output: out(diff) };
  const parsed = parseGitNumstat(diff.stdout ?? '');

  const remote = await git(['remote', 'get-url', 'origin'], intPath);
  const hasRemote = ok(remote) && Boolean(`${remote.stdout ?? ''}`.trim());

  let hasGh = false;
  try {
    const gh = await runProcess('gh', ['--version'], { cwd: intPath, timeout: 10_000 });
    hasGh = gh.code === 0;
  } catch {
    hasGh = false;
  }

  return {
    ok: true,
    additions: parsed.additions,
    deletions: parsed.deletions,
    fileCount: parsed.paths.length,
    hasRemote,
    hasGh,
  };
}

/**
 * Diff stats for landing board work: integration branch vs the workspace checkout
 * (`git diff --numstat HEAD...<branch>` when not yet merged).
 * @param {{ branch: string }} input
 */
export async function workspaceLandingStats({ branch }) {
  const workspace = getWorkspaceRoot();
  const intBranch = (branch && branch.trim()) || '';
  if (!intBranch) return { ok: false, error: 'branch required' };
  if (!(await branchExists(intBranch))) {
    return { ok: false, error: 'integration branch not found' };
  }

  const current = await git(['branch', '--show-current'], workspace);
  const currentBranch = `${current.stdout ?? ''}`.trim() || null;

  const ancestor = await git(['merge-base', '--is-ancestor', intBranch, 'HEAD'], workspace);
  const alreadyLanded = ancestor.code === 0;

  const diff = alreadyLanded
    ? await git(['diff', '--numstat'], workspace)
    : await git(['diff', '--numstat', `HEAD...${intBranch}`], workspace);
  if (!ok(diff)) return { ok: false, output: out(diff) };
  const parsed = parseGitNumstat(diff.stdout ?? '');

  const remote = await git(['remote', 'get-url', 'origin'], workspace);
  const hasRemote = ok(remote) && Boolean(`${remote.stdout ?? ''}`.trim());

  let hasGh = false;
  try {
    const gh = await runProcess('gh', ['--version'], { cwd: workspace, timeout: 10_000 });
    hasGh = gh.code === 0;
  } catch {
    hasGh = false;
  }

  return {
    ok: true,
    additions: parsed.additions,
    deletions: parsed.deletions,
    fileCount: parsed.paths.length,
    hasRemote,
    hasGh,
    alreadyLanded,
    currentBranch,
  };
}

/**
 * Merge the board integration branch into the user's workspace checkout (current branch).
 * @param {{ branch: string, message?: string }} input
 */
export async function mergeIntegrationIntoWorkspace({ branch, message }) {
  const workspace = getWorkspaceRoot();
  const intBranch = (branch && branch.trim()) || '';
  if (!intBranch) return { ok: false, error: 'branch required' };
  if (!(await branchExists(intBranch))) {
    return { ok: false, error: 'integration branch not found' };
  }

  const mergeHead = await git(['rev-parse', '--verify', 'MERGE_HEAD'], workspace);
  if (mergeHead.code === 0) {
    return {
      ok: false,
      error: 'workspace_merge_in_progress',
      output: 'Resolve or abort the in-progress merge in your workspace first.',
    };
  }

  const ancestor = await git(['merge-base', '--is-ancestor', intBranch, 'HEAD'], workspace);
  if (ancestor.code === 0) {
    return { ok: true, merged: false, alreadyUpToDate: true };
  }

  const mergeMsg = (message && message.trim()) || `Merge ${intBranch}`;
  const merge = await git(['merge', '--no-edit', intBranch, '-m', mergeMsg], workspace);
  if (!ok(merge)) {
    const conflict = await git(['rev-parse', '--verify', 'MERGE_HEAD'], workspace);
    return {
      ok: false,
      merged: false,
      conflict: conflict.code === 0,
      output: out(merge),
      error: conflict.code === 0 ? 'merge_conflict' : 'merge_failed',
    };
  }
  return { ok: true, merged: true, output: out(merge) };
}

/**
 * Open a GitHub PR for the workspace's current branch via `gh pr create`.
 * @param {{ title?: string, body?: string }} input
 */
export async function openWorkspacePr({ title, body }) {
  const workspace = getWorkspaceRoot();
  const branchResult = await git(['branch', '--show-current'], workspace);
  const branch = `${branchResult.stdout ?? ''}`.trim();
  if (!branch) {
    return { ok: false, error: 'detached_head', output: 'Checkout a branch before opening a PR.' };
  }

  let ghAvailable = false;
  try {
    const gh = await runProcess('gh', ['--version'], { cwd: workspace, timeout: 10_000 });
    ghAvailable = gh.code === 0;
  } catch {
    ghAvailable = false;
  }
  if (!ghAvailable) {
    return { ok: false, error: 'gh_unavailable', output: 'GitHub CLI (gh) is not installed' };
  }

  const args = ['pr', 'create', '--head', branch];
  const titleText = (title && title.trim()) || `Orchestrate: ${branch}`;
  const bodyText = (body && body.trim()) || '';
  args.push('--title', titleText);
  if (bodyText) args.push('--body', bodyText);

  const r = await runProcess('gh', args, { cwd: workspace, timeout: 120_000 });
  const text = out(r);
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (!ok(r)) return { ok: false, output: text, error: 'gh_failed' };
  return { ok: true, url: urlMatch?.[0], output: text };
}

/**
 * Stage and commit all changes in the board integration worktree (no empty commits).
 * @param {{ boardId: string, message?: string }} input
 */
export async function commitIntegration({ boardId, message }) {
  return commitWorktree({ boardId, slotId: 'integration', message });
}

/**
 * Push the integration branch to `origin` (soft-fails when no remote).
 * @param {{ boardId: string, branch: string }} input
 */
export async function pushIntegration({ boardId, branch }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const remote = await git(['remote', 'get-url', 'origin'], intPath);
  if (!ok(remote) || !`${remote.stdout ?? ''}`.trim()) {
    return {
      ok: false,
      pushed: false,
      error: 'no_remote',
      output: 'No origin remote configured',
    };
  }
  const b = (branch && branch.trim()) || '';
  if (!b) return { ok: false, error: 'branch required' };
  const push = await git(['push', '-u', 'origin', b], intPath);
  if (!ok(push)) return { ok: false, pushed: false, output: out(push) };
  return { ok: true, pushed: true, output: out(push) };
}

/**
 * Open a GitHub PR for the integration branch via `gh pr create` (soft-fails when gh is absent).
 * @param {{ boardId: string, branch: string, title?: string, body?: string }} input
 */
export async function openPr({ boardId, branch, title, body }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const b = (branch && branch.trim()) || '';
  if (!b) return { ok: false, error: 'branch required' };

  let ghAvailable = false;
  try {
    const gh = await runProcess('gh', ['--version'], { cwd: intPath, timeout: 10_000 });
    ghAvailable = gh.code === 0;
  } catch {
    ghAvailable = false;
  }
  if (!ghAvailable) {
    return { ok: false, error: 'gh_unavailable', output: 'GitHub CLI (gh) is not installed' };
  }

  const args = ['pr', 'create', '--head', b];
  const titleText = (title && title.trim()) || `Orchestrate: ${b}`;
  const bodyText = (body && body.trim()) || '';
  args.push('--title', titleText);
  if (bodyText) args.push('--body', bodyText);

  const r = await runProcess('gh', args, { cwd: intPath, timeout: 120_000 });
  const text = out(r);
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (!ok(r)) return { ok: false, output: text, error: 'gh_failed' };
  return { ok: true, url: urlMatch?.[0], output: text };
}

/** Raw `git worktree list --porcelain` for the active repo. */
export async function listWorktrees() {
  const r = await git(['worktree', 'list', '--porcelain']);
  return { ok: ok(r), output: out(r) };
}

/**
 * Create (or attach) a managed per-chat worktree under ~/.minnow/worktrees/.../chat/<chatId>.
 * Idempotent when the slot already exists on the expected branch.
 * @param {{ chatId: string, branch: string, baseRef?: string }} input
 */
export async function createChatWorktree({ chatId, branch, baseRef }) {
  if (!chatId || typeof chatId !== 'string' || !chatId.trim()) {
    return { ok: false, error: 'chatId is required' };
  }
  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    return { ok: false, error: 'branch is required' };
  }

  const wtPath = getChatWorktreePath(chatId.trim());
  const branchName = branch.trim();
  const base = (baseRef && baseRef.trim()) || 'HEAD';
  const depSource = getWorkspaceRoot();

  let exists = false;
  try {
    await fs.access(wtPath);
    exists = true;
  } catch {
    /* create below */
  }

  if (exists) {
    return { ok: true, path: wtPath, branch: branchName, created: false };
  }

  await fs.mkdir(path.dirname(wtPath), { recursive: true });
  const baseSha = await resolveRef(base);
  if (!baseSha) {
    return { ok: false, error: `invalid baseRef: ${base}`, path: wtPath, branch: branchName };
  }

  if (await branchExists(branchName)) {
    const w = await git(['worktree', 'add', wtPath, branchName]);
    if (!ok(w)) return { ok: false, path: wtPath, branch: branchName, output: out(w) };
    await symlinkDependencyDirs(depSource, wtPath);
    return { ok: true, path: wtPath, branch: branchName, created: true };
  }

  const r = await git(['worktree', 'add', '-b', branchName, wtPath, baseSha]);
  if (!ok(r)) return { ok: false, path: wtPath, branch: branchName, output: out(r) };
  await symlinkDependencyDirs(depSource, wtPath);
  return { ok: true, path: wtPath, branch: branchName, created: true };
}

/**
 * Remove a managed per-chat worktree slot (MIN-276 chat delete / detach).
 * @param {{ chatId: string }} input
 */
export async function removeChatWorktree({ chatId }) {
  if (!chatId || typeof chatId !== 'string' || !chatId.trim()) {
    return { ok: false, error: 'chatId is required' };
  }
  const wtPath = getChatWorktreePath(chatId.trim());
  if (!isPathUnderWorktreesRoot(wtPath)) {
    return { ok: false, error: 'refusing to remove path outside the worktrees root' };
  }
  try {
    await fs.access(wtPath);
  } catch {
    return { ok: true, path: wtPath, removed: false };
  }
  const r = await git(['worktree', 'remove', '--force', wtPath]);
  await git(['worktree', 'prune']);
  try {
    await fs.rm(wtPath, { recursive: true, force: true });
  } catch {
    /* best-effort — Windows may keep a handle */
  }
  return { ok: true, path: wtPath, removed: true, output: out(r) };
}

/**
 * After a merge into integration, install deps when the merge diff touched manifests/lockfiles.
 * @param {{ boardId: string, sinceSha?: string }} input
 */
export async function refreshIntegrationDeps({ boardId, sinceSha }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const since = (sinceSha && sinceSha.trim()) || '';
  if (!since) return { ok: true, ran: [], skipped: 'no sinceSha' };
  const diff = await git(['diff', '--name-only', since, 'HEAD'], intPath);
  if (!ok(diff)) return { ok: false, output: out(diff) };
  const changedFiles = `${diff.stdout ?? ''}`
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const { ran, failed } = await refreshDependencies(intPath, changedFiles);
  return { ok: true, ran, failed };
}
