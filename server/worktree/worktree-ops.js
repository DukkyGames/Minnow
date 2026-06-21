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
import { getWorkspaceRoot } from '../workspace/root.js';
import {
  getBoardWorktreesDir,
  getWorktreeSlotPath,
  isPathUnderWorktreesRoot,
} from './paths.js';

const GIT_TIMEOUT_MS = 120_000;

async function git(args, cwd = getWorkspaceRoot()) {
  return runProcess('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
}

const ok = (r) => r.code === 0;
const out = (r) => `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();

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
 * @param {{ boardId: string }} input
 */
export async function cleanupBoardWorktrees({ boardId }) {
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
    // Keep the integration worktree so MIN-208 can commit/push from it.
    if (slot === 'integration') {
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

/** Raw `git worktree list --porcelain` for the active repo. */
export async function listWorktrees() {
  const r = await git(['worktree', 'list', '--porcelain']);
  return { ok: ok(r), output: out(r) };
}
