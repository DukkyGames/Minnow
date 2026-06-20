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
 * inside the integration worktree. On conflict, aborts and reports (caller decides
 * whether to spawn a fixer sub-agent — no user prompt per MIN-265).
 * @param {{ boardId: string, fromBranch: string, message?: string }} input
 */
export async function mergeIntoIntegration({ boardId, fromBranch, message }) {
  const intPath = getWorktreeSlotPath(boardId, 'integration');
  try {
    await fs.access(intPath);
  } catch {
    return { ok: false, error: 'integration worktree missing' };
  }
  const args = ['merge', '--no-edit'];
  if (message && message.trim()) args.push('-m', message.trim());
  args.push(fromBranch);
  const m = await git(args, intPath);
  if (!ok(m)) {
    await git(['merge', '--abort'], intPath);
    return { ok: false, conflict: true, output: out(m) };
  }
  return { ok: true, output: out(m) };
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
