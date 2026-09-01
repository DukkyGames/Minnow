/**
 * Git worktree operations for board task isolation (MIN-275).
 * All git runs against the active Code workspace repo; worktrees and the board
 * integration branch are created off to the side under ~/.minnow/worktrees.
 *
 * Merges run INSIDE the integration worktree so the user's main working tree and
 * checked-out branch are never touched.
 *
 * Rebase (MIN-706 / P3-B) runs INSIDE the task worktree onto the integration tip.
 * A conflict is a typed result, not an exception: abort, then hand the worktree
 * back clean. Rebase and merge share one in-process mutex keyed by boardId.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../process-runner.js';
import { parseGitNumstat } from '../tools/git-change-stats.js';
import { invalidateRegisteredWorktreeCache } from './allowlist.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { slugifyGitRefName } from '../../src/lib/git-branch-slug.mjs';
import { refreshDependencies } from './dep-install.js';
import { ensureDependencyDirs, hasBrokenDepDir } from './dep-symlinks.js';
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

/** Human-readable summary of the dep failures in an `ensureDependencyDirs` result. */
const depFailureOutput = (deps) => deps.failed.map((f) => f.reason).join('; ');

/**
 * Seed known dependency dirs into a task/wave worktree.
 *
 * Prefer the integration tree (it may hold post-merge installs). If that source
 * is unusable, fall back to the main workspace — a broken integration
 * `node_modules` must not stall the next task. Fail closed only when the
 * *target* still has a broken link after both attempts (the ELOOP class).
 *
 * @param {string} wtPath
 * @param {string} intPath
 * @returns {Promise<{ ok: true, deps: { ok: boolean, linked: string[], repaired: string[], failed: Array<{ dir: string, reason: string }> } } | { ok: false, error: 'deps', deps: object, output: string }>}
 */
async function seedTaskWorktreeDeps(wtPath, intPath) {
  const workspace = getWorkspaceRoot();
  const preferred = (await pathExists(intPath)) ? intPath : workspace;
  let deps = await ensureDependencyDirs(preferred, wtPath);
  if (!deps.ok && preferred !== workspace) {
    // Integration source did not resolve. The main workspace is what
    // ensureIntegration seeds from — retry so a stale integration link is not
    // a board-wide allocate failure.
    deps = await ensureDependencyDirs(workspace, wtPath);
  }
  if (await hasBrokenDepDir(wtPath)) {
    return {
      ok: false,
      error: 'deps',
      deps,
      output: depFailureOutput(deps) || 'worktree still has a broken dependency link',
    };
  }
  return { ok: true, deps };
}

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
async function resolveRef(ref, cwd = getWorkspaceRoot()) {
  const r = await git(['rev-parse', '--verify', ref], cwd);
  if (!ok(r)) return null;
  const sha = `${r.stdout ?? ''}`.trim().split(/\s/)[0];
  return sha || null;
}

/**
 * One promise chain per board for ops that mutate the integration lineage
 * (merge into integration, rebase a task onto it, abort, restore).
 *
 * `mergeInProgress` is only a MERGE_HEAD probe — it is not a mutex. Two
 * concurrent rebase+merge calls against one board would otherwise race:
 * rebase rewriting a branch merge is reading, or merge advancing the tip
 * rebase is onto-ing. Same shape as journal.js `serialise`.
 *
 * @type {Map<string, Promise<unknown>>}
 */
const integrationOpChains = new Map();

/** Currently executing locked-op count per board (0 or 1 when the chain holds). */
const activeIntegrationOps = new Map();

/** Peak overlapping locked ops observed per board — 1 means they serialised. */
const peakIntegrationOps = new Map();

/**
 * Run `task` after every integration op already queued for this board.
 * A rejection must not break the chain, or one failed merge wedges the board.
 *
 * @template T
 * @param {string} boardId
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function withBoardIntegrationLock(boardId, task) {
  const key = boardId || '';
  const previous = integrationOpChains.get(key) ?? Promise.resolve();
  const run = async () => {
    const nextActive = (activeIntegrationOps.get(key) ?? 0) + 1;
    activeIntegrationOps.set(key, nextActive);
    peakIntegrationOps.set(key, Math.max(peakIntegrationOps.get(key) ?? 0, nextActive));
    try {
      return await task();
    } finally {
      const left = (activeIntegrationOps.get(key) ?? 1) - 1;
      if (left <= 0) activeIntegrationOps.delete(key);
      else activeIntegrationOps.set(key, left);
    }
  };
  const next = previous.then(run, run);
  integrationOpChains.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

/** Test seam: peak overlapping rebase/merge ops for one board (1 = serialised). */
export function peakBoardIntegrationLockDepth(boardId) {
  return peakIntegrationOps.get(boardId || '') ?? 0;
}

/** Test seam: clear the mutex between fixtures. */
export function resetBoardIntegrationLock() {
  integrationOpChains.clear();
  activeIntegrationOps.clear();
  peakIntegrationOps.clear();
}

/** True while a locked merge/rebase/abort/restore is executing for this board. */
function isBoardIntegrationLocked(boardId) {
  return (activeIntegrationOps.get(boardId || '') ?? 0) > 0;
}

/**
 * Absolute path git would use for a named git-dir file (worktree-aware).
 * Linked worktrees store rebase state under `.git/worktrees/<id>/`, not the
 * checkout root, so callers must not look at `<wt>/.git/rebase-merge` directly.
 *
 * @param {string} wtPath
 * @param {string} name
 * @returns {Promise<string | null>}
 */
async function gitDirPath(wtPath, name) {
  const r = await git(['rev-parse', '--git-path', name], wtPath);
  const p = `${r.stdout ?? ''}`.trim();
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(wtPath, p);
}

/** True when `rebase-merge` or `rebase-apply` exists for this worktree. */
async function rebaseStateExists(wtPath) {
  const mergePath = await gitDirPath(wtPath, 'rebase-merge');
  const applyPath = await gitDirPath(wtPath, 'rebase-apply');
  return (
    Boolean(mergePath && (await pathExists(mergePath))) ||
    Boolean(applyPath && (await pathExists(applyPath)))
  );
}

/**
 * Abort an in-progress rebase and verify the state dirs are gone.
 * `git rebase --abort`'s exit code is not trusted; we check the files.
 * `shaBefore` is the pre-rebase HEAD used if abort leaves the tree dirty.
 *
 * @param {string} wtPath
 * @param {string | null} shaBefore
 */
async function abortRebaseAndVerify(wtPath, shaBefore) {
  if (!(await rebaseStateExists(wtPath))) return;
  await git(['rebase', '--abort'], wtPath);
  if (!(await rebaseStateExists(wtPath))) return;

  // --abort did not clear state. --quit drops the rebase files; then restore tip.
  await git(['rebase', '--quit'], wtPath);
  if (shaBefore) {
    await git(['reset', '--hard', shaBefore], wtPath);
  }
  await git(['clean', '-fd'], wtPath);
  if (!(await rebaseStateExists(wtPath))) return;

  // Last resort: remove leftover dirs so an agent never inherits a half-rebase.
  const mergePath = await gitDirPath(wtPath, 'rebase-merge');
  const applyPath = await gitDirPath(wtPath, 'rebase-apply');
  if (mergePath && (await pathExists(mergePath))) {
    await fs.rm(mergePath, { recursive: true, force: true });
  }
  if (applyPath && (await pathExists(applyPath))) {
    await fs.rm(applyPath, { recursive: true, force: true });
  }
}

/** Split `git diff --name-only` stdout into path strings. */
function parseNameOnly(stdout) {
  return `${stdout ?? ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
  if (await pathExists(intPath)) {
    // Re-validate on reuse: task worktrees chain their dep links off integration, so a
    // broken link here breaks every task in the wave.
    const deps = await ensureDependencyDirs(getWorkspaceRoot(), intPath);
    return { ok: true, path: intPath, branch, created: false, deps };
  }
  await fs.mkdir(path.dirname(intPath), { recursive: true });
  const w = await git(['worktree', 'add', intPath, branch]);
  if (!ok(w)) return { ok: false, stage: 'worktree', path: intPath, output: out(w) };
  const deps = await ensureDependencyDirs(getWorkspaceRoot(), intPath);
  return { ok: true, path: intPath, branch, created: true, deps };
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
 *
 * Branch names are owned by worktree-isolation.ts — do not slugify here (MIN-659).
 * @param {{ boardId: string, slotId: string, branch: string, baseRef?: string }} input
 */
export async function createWorktree({ boardId, slotId, branch, baseRef }) {
  const wtPath = getWorktreeSlotPath(boardId, slotId);
  const base = (baseRef && baseRef.trim()) || 'HEAD';
  const intPath = getWorktreeSlotPath(boardId, 'integration');

  let exists = false;
  try {
    await fs.access(wtPath);
    exists = true;
  } catch {
    /* create below */
  }

  if (exists) {
    // Heal first: a reused slot may carry a dangling/looping dep link from an earlier
    // pass, and nothing else in the board flow ever re-validates it.
    const seeded = await seedTaskWorktreeDeps(wtPath, intPath);
    if (!seeded.ok) {
      return {
        ok: false,
        error: 'deps',
        path: wtPath,
        branch,
        created: false,
        deps: seeded.deps,
        output: seeded.output,
      };
    }
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
    return { ok: true, path: wtPath, branch, created: false, synced: true, deps: seeded.deps };
  }

  await fs.mkdir(path.dirname(wtPath), { recursive: true });
  const baseSha = await resolveRef(base);
  if (!baseSha) {
    return { ok: false, error: `invalid baseRef: ${base}`, path: wtPath, branch };
  }

  if (await branchExists(branch)) {
    const w = await git(['worktree', 'add', wtPath, branch]);
    if (!ok(w)) return { ok: false, path: wtPath, branch, output: out(w) };
    const seeded = await seedTaskWorktreeDeps(wtPath, intPath);
    if (!seeded.ok) {
      return {
        ok: false,
        error: 'deps',
        path: wtPath,
        branch,
        created: true,
        deps: seeded.deps,
        output: seeded.output,
      };
    }
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
    return { ok: true, path: wtPath, branch, created: true, deps: seeded.deps };
  }

  const r = await git(['worktree', 'add', '-b', branch, wtPath, baseSha]);
  if (!ok(r)) return { ok: false, path: wtPath, branch, output: out(r) };
  const seeded = await seedTaskWorktreeDeps(wtPath, intPath);
  if (!seeded.ok) {
    return {
      ok: false,
      error: 'deps',
      path: wtPath,
      branch,
      created: true,
      deps: seeded.deps,
      output: seeded.output,
    };
  }
  return { ok: true, path: wtPath, branch, created: true, deps: seeded.deps };
}

/**
 * Merge a task/wave branch into the board integration branch, running the merge
 * inside the integration worktree. On conflict, leaves the merge in progress
 * (MERGE_HEAD + conflict stages) so a fixer can resolve and `git commit --no-edit`
 * to record a true two-parent merge.
 * @param {{ boardId: string, fromBranch: string, message?: string }} input
 */
export async function mergeIntoIntegration(input) {
  return withBoardIntegrationLock(input.boardId, () => mergeIntoIntegrationUnlocked(input));
}

/** @param {{ boardId: string, fromBranch: string, message?: string }} input */
async function mergeIntoIntegrationUnlocked({ boardId, fromBranch, message }) {
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
    const conflictedFiles = parseNameOnly(diff.stdout);
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
 * (MERGE_HEAD is set) or a locked rebase/merge is executing for this board.
 * Returns { ok: true, inProgress: boolean }.
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
  return { ok: true, inProgress: r.code === 0 || isBoardIntegrationLocked(boardId) };
}

/**
 * Resolve a ref inside the board integration worktree (MIN-707).
 *
 * The merge queue snapshots HEAD before merging (`beforeSha`) so a failed
 * verify can `restoreIntegration`, and reads HEAD afterwards for the
 * `merge.succeeded` sha. `MERGE_HEAD` / `ORIG_HEAD` are the restart-recovery
 * probes: a half-applied merge is never left sitting.
 *
 * @param {{ boardId: string, ref?: string }} input
 * @returns {Promise<string | null>}
 */
export async function readIntegrationRef({ boardId, ref = 'HEAD' }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return null;
  }
  const name = (ref && String(ref).trim()) || 'HEAD';
  return resolveRef(name, intPath);
}

/**
 * Rebase a task/wave worktree onto the current board integration tip (MIN-706).
 *
 * A conflict is a normal outcome, not an exception: `{ ok: false, conflicts }`
 * after aborting so the worktree is the pre-rebase tree, agent-usable.
 * Already-up-to-date and empty (nothing to replay) return `{ ok: true, sha }`
 * with the unchanged SHA and do not start a rebase.
 *
 * Serialised with `mergeIntoIntegration` via the board-keyed mutex.
 *
 * @param {{ boardId: string, slotId: string }} input
 * @returns {Promise<{ ok: true, sha: string } | { ok: false, conflicts: string[], error?: string }>}
 */
export async function rebaseOntoIntegration(input) {
  return withBoardIntegrationLock(input.boardId, () => rebaseOntoIntegrationUnlocked(input));
}

/** @param {{ boardId: string, slotId: string }} input */
async function rebaseOntoIntegrationUnlocked({ boardId, slotId }) {
  const wtPath = getWorktreeSlotPath(boardId, slotId);
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(wtPath);
  } catch {
    return { ok: false, error: 'worktree missing', conflicts: [] };
  }
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing', conflicts: [] };
  }

  const shaBefore = await resolveRef('HEAD', wtPath);
  const intSha = await resolveRef('HEAD', intPath);
  if (!shaBefore) return { ok: false, error: 'could not resolve worktree HEAD', conflicts: [] };
  if (!intSha) return { ok: false, error: 'could not resolve integration HEAD', conflicts: [] };

  // Unique commits on the task branch vs the integration tip. Zero means there
  // is nothing to replay — empty branch or already merged — so do not start a
  // rebase (git can report a spurious conflict on an empty replay).
  const unique = await git(['rev-list', '--count', `${intSha}..HEAD`], wtPath);
  const uniqueCount = Number.parseInt(`${unique.stdout ?? ''}`.trim(), 10) || 0;
  if (uniqueCount === 0) {
    return { ok: true, sha: shaBefore };
  }

  const rebase = await git(['rebase', intSha], wtPath);
  if (ok(rebase)) {
    const shaAfter = (await resolveRef('HEAD', wtPath)) || shaBefore;
    return { ok: true, sha: shaAfter };
  }

  // Capture conflicted paths BEFORE abort — abort clears the unmerged index.
  const diff = await git(['diff', '--name-only', '--diff-filter=U'], wtPath);
  const conflicts = parseNameOnly(diff.stdout);

  await abortRebaseAndVerify(wtPath, shaBefore);

  if (conflicts.length > 0) {
    return { ok: false, conflicts };
  }
  return {
    ok: false,
    conflicts: [],
    error: out(rebase) || 'rebase failed',
  };
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
export async function restoreIntegration(input) {
  return withBoardIntegrationLock(input.boardId, () => restoreIntegrationUnlocked(input));
}

/** @param {{ boardId: string, sha: string }} input */
async function restoreIntegrationUnlocked({ boardId, sha }) {
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
export async function abortMerge(input) {
  return withBoardIntegrationLock(input.boardId, () => abortMergeUnlocked(input));
}

/** @param {{ boardId: string }} input */
async function abortMergeUnlocked({ boardId }) {
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
    await fs.rm(wtPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* the lstat below is the authority, not the rm */
  }
  // Report the truth: a surviving dir is an orphan slot that a later createWorktree
  // would silently reuse, dep links and all.
  if (await pathExists(wtPath)) {
    return {
      ok: false,
      error: 'worktree directory survived removal',
      path: wtPath,
      output: out(r),
    };
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
  const failedSlots = [];
  for (const slot of slots) {
    // Keep integration until the user lands work in the workspace (MIN-208 finish dashboard).
    if (!includeIntegration && slot === 'integration') {
      keptIntegration = true;
      continue;
    }
    const r = await removeWorktree({ boardId, slotId: slot });
    if (r.ok) {
      removed += 1;
    } else {
      failedSlots.push(slot);
      console.warn(
        `[worktree] ${boardId}/${slot} survived cleanup: ${r.error || r.output || 'unknown'}`,
      );
    }
  }
  await git(['worktree', 'prune']);
  if (!keptIntegration) {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* best-effort */
    }
  }
  return { ok: true, removed, keptIntegration, failedSlots };
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
 * Capability probe for the workspace checkout: whether `origin` and the `gh` CLI
 * are usable for push / PR actions.
 */
async function workspaceGitCapabilities(workspace) {
  const remote = await git(['remote', 'get-url', 'origin'], workspace);
  const hasRemote = ok(remote) && Boolean(`${remote.stdout ?? ''}`.trim());
  let hasGh = false;
  try {
    const gh = await runProcess('gh', ['--version'], { cwd: workspace, timeout: 10_000 });
    hasGh = gh.code === 0;
  } catch {
    hasGh = false;
  }
  return { hasRemote, hasGh };
}

/**
 * Diff stats for the *uncommitted* workspace checkout — the isolation-off case,
 * where agents wrote straight into the user's tree and there is no branch to land.
 * Untracked files never appear in `git diff`, so they are counted from status.
 */
async function workspaceDirtyStats() {
  const workspace = getWorkspaceRoot();
  const diff = await git(['diff', '--numstat', 'HEAD'], workspace);
  if (!ok(diff)) return { ok: false, output: out(diff) };
  const parsed = parseGitNumstat(diff.stdout ?? '');

  const status = await git(['status', '--porcelain'], workspace);
  const untracked = `${status.stdout ?? ''}`
    .split(/\r?\n/)
    .filter((line) => line.startsWith('?? ')).length;

  const current = await git(['branch', '--show-current'], workspace);
  const { hasRemote, hasGh } = await workspaceGitCapabilities(workspace);

  return {
    ok: true,
    additions: parsed.additions,
    deletions: parsed.deletions,
    fileCount: parsed.paths.length + untracked,
    untrackedCount: untracked,
    hasRemote,
    hasGh,
    alreadyLanded: false,
    dirtyWorkspace: true,
    currentBranch: `${current.stdout ?? ''}`.trim() || null,
  };
}

/**
 * Diff stats for landing board work: integration branch vs the workspace checkout
 * (`git diff --numstat HEAD...<branch>` when not yet merged).
 *
 * With no branch it falls back to the uncommitted workspace diff instead of
 * erroring — a board run with isolation off has no branch but still has work.
 * @param {{ branch?: string }} input
 */
export async function workspaceLandingStats({ branch } = {}) {
  const workspace = getWorkspaceRoot();
  const intBranch = (branch && branch.trim()) || '';
  if (!intBranch) return workspaceDirtyStats();
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

  const { hasRemote, hasGh } = await workspaceGitCapabilities(workspace);

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
  const branchName = slugifyGitRefName(branch, 'worktree');
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
    const deps = await ensureDependencyDirs(depSource, wtPath);
    invalidateRegisteredWorktreeCache();
    return { ok: true, path: wtPath, branch: branchName, created: true, deps };
  }

  const r = await git(['worktree', 'add', '-b', branchName, wtPath, baseSha]);
  if (!ok(r)) return { ok: false, path: wtPath, branch: branchName, output: out(r) };
  const deps = await ensureDependencyDirs(depSource, wtPath);
  invalidateRegisteredWorktreeCache();
  return { ok: true, path: wtPath, branch: branchName, created: true, deps };
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
  invalidateRegisteredWorktreeCache();
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
