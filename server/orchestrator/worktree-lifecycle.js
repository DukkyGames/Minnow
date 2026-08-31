/**
 * P3-A — engine-owned worktree lifecycle.
 *
 * The journal is the only record of which worktree an attempt used
 * (`task.attempt.started.worktree`). There is no registry, allocation map, or
 * release-queue file: orphan reclaim is `git worktree list` minus journal-live,
 * the same shape as `inspect()` versus `desired`.
 *
 * Git plumbing stays in `server/worktree/worktree-ops.js`. This module owns
 * *when* those ops run and *what* the journal considers live.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { attemptCount } from './core/derive.js';
import { decide, wantsSameWorktree } from './core/policy.js';
import { getBoardWorktreesDir, getWorktreeSlotPath } from '../worktree/paths.js';
import { ensureDependencyDirs } from '../worktree/dep-symlinks.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import {
  checkWorktreeDirty,
  commitWorktree,
  createWorktree,
  ensureIntegration,
  listWorktrees,
  refreshIntegrationDeps,
  removeWorktree,
} from '../worktree/worktree-ops.js';
import { initializeWorkspaceGit } from '../workspace/initialize-git.js';

/** Integration slot name used by `getWorktreeSlotPath`. Never reclaimed as an orphan. */
export const INTEGRATION_SLOT = 'integration';

/**
 * Opaque journal type for dirty work that was discarded on removal.
 *
 * Not in the P0-B known vocabulary: the fold ignores it (unknown types are
 * opaque), and P0-B's envelope already accepts that. A dedicated schema would
 * bump the thirteen-type contract for a side-effect the fold never reads.
 */
export const WORKTREE_DISCARDED_TYPE = 'worktree.discarded';

/**
 * Opaque journal type when Start created a workspace repo or its first commit.
 *
 * Same pattern as {@link WORKTREE_DISCARDED_TYPE}: not a 14th known fold type.
 * The timeline already prints unknown `event.type`.
 */
export const BOARD_GIT_INITIALIZED_TYPE = 'board.git.initialized';

/**
 * Boards that have had `ensureIntegration` succeed this process.
 *
 * The op is already idempotent; this only skips a git round-trip. Dep links
 * are still re-validated on every allocate — a broken integration
 * `node_modules` must not stall the next task. It is not an ownership
 * registry — crash recovery re-runs `ensureIntegration`.
 *
 * @type {Set<string>}
 */
const ensuredBoards = new Set();

/**
 * @param {string} boardId
 * @returns {string}
 */
export function integrationBranch(boardId) {
  return `minnow/board/${boardId}/integration`;
}

/**
 * @param {string} boardId
 * @param {string} slotId
 * @returns {string}
 */
export function attemptBranch(boardId, slotId) {
  return `minnow/board/${boardId}/${slotId}`;
}

/**
 * Slot directory for a new attempt. Attempt ids are unique, so two concurrent
 * attempts never collide here — isolation is a path, not a lock.
 *
 * @param {string} attemptId
 * @returns {string}
 */
export function slotIdForAttempt(attemptId) {
  return String(attemptId);
}

/**
 * Absolute worktree paths from `git worktree list --porcelain`.
 *
 * @param {string} porcelain
 * @returns {string[]}
 */
export function parseWorktreePorcelain(porcelain) {
  /** @type {string[]} */
  const paths = [];
  for (const raw of String(porcelain ?? '').split(/\r?\n/)) {
    if (!raw.startsWith('worktree ')) continue;
    const wt = raw.slice('worktree '.length).trim();
    if (wt) paths.push(path.resolve(wt));
  }
  return paths;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return path.resolve(String(value));
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function pathsEqual(a, b) {
  const left = normalizePath(a);
  const right = normalizePath(b);
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/**
 * Worktree paths the journal currently says are live: open (started, not ended)
 * attempts. Same shape as `inspect()` — ended attempts are not live, even if
 * a retry is about to reuse the path.
 *
 * @param {import('./core/types').BoardState | null | undefined} state
 * @returns {Set<string>}
 */
export function liveWorktreePaths(state) {
  /** @type {Set<string>} */
  const live = new Set();
  if (!state?.tasks) return live;
  for (const task of state.tasks.values()) {
    for (const attempt of task.attempts) {
      if (attempt.ended) continue;
      if (typeof attempt.worktree !== 'string' || !attempt.worktree) continue;
      live.add(normalizePath(attempt.worktree));
    }
  }
  return live;
}

/**
 * Most recent worktree recorded for a task, open or ended.
 *
 * Lookup into the journal fold, not a parallel map. A `repair` / `continue`
 * retry (and the tester after a builder pass) use this path.
 *
 * @param {import('./core/types').BoardState | null | undefined} state
 * @param {string} taskId
 * @returns {string | null}
 */
export function previousWorktreeForTask(state, taskId) {
  const task = state?.tasks?.get(taskId);
  if (!task) return null;
  for (let i = task.attempts.length - 1; i >= 0; i -= 1) {
    const wt = task.attempts[i].worktree;
    if (typeof wt === 'string' && wt) return wt;
  }
  return null;
}

/**
 * @param {string} boardId
 * @param {string} worktreePath
 * @returns {string | null}
 */
export function slotIdFromWorktreePath(boardId, worktreePath) {
  const dir = getBoardWorktreesDir(boardId);
  const rel = path.relative(normalizePath(dir), normalizePath(worktreePath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const slot = rel.split(/[\\/]/)[0];
  return slot || null;
}

/**
 * Should this attempt's worktree survive its end so the next start can reuse it?
 *
 * Uses the policy table rather than a hidden slot map: keep iff the next action
 * is a same-worktree retry, a builder pass advancing to tester, or a tester
 * pass advancing to merge (P3-C rebases that same committed tree).
 *
 * @param {import('./core/types').BoardState} state
 * @param {import('./core/types').Desired} desired
 * @param {string} outcome
 * @returns {boolean}
 */
export function shouldKeepWorktree(state, desired, outcome) {
  if (!desired?.taskId) return false;
  const action = decide({
    role: desired.role,
    outcome,
    // The current attempt is not ended in the journal yet, so this count is
    // already "finished before now" — the reading `decide()` documents.
    attemptCount: attemptCount(state, desired.taskId, desired.role),
  });
  if (action.kind === 'retry') return wantsSameWorktree(action.seedKind);
  return action.kind === 'advance' && (action.to === 'tester' || action.to === 'merge');
}

/**
 * Should `start(desired)` attach the previous path instead of creating a slot?
 *
 * `desired.sameWorktree` / `wantsSameWorktree(seedKind)` cover repair,
 * continue, and rebase. Tester is not a retry, but it still has to run in
 * the builder's tree — nothing has merged yet.
 *
 * @param {import('./core/types').Desired} desired
 * @returns {boolean}
 */
export function wantsReuse(desired) {
  if (!desired) return false;
  if (desired.sameWorktree) return true;
  if (wantsSameWorktree(desired.seedKind)) return true;
  return desired.role === 'tester';
}

/**
 * MIN-615 git init for isolated-worktree boards. Idempotent: a repo that already
 * has HEAD is a no-op. `parsePlan` stays pure — this is I/O on the effector path.
 *
 * @returns {Promise<{
 *   ok: true,
 *   event: {
 *     createdRepo: boolean,
 *     gitignoreCreated: boolean,
 *     committed: boolean,
 *     commitSha?: string,
 *   } | null,
 * } | { ok: false, error: string }>}
 */
export async function ensureBoardWorkspaceGit() {
  const result = await initializeWorkspaceGit();
  if (!result.ok) {
    return { ok: false, error: result.error || 'git init failed' };
  }
  // Journal only when something actually appeared — not when we touched an
  // existing checkout (gitignore repair with HEAD already present).
  if (!result.createdRepo && !result.committed) {
    return { ok: true, event: null };
  }
  return {
    ok: true,
    event: {
      createdRepo: Boolean(result.createdRepo),
      gitignoreCreated: Boolean(result.gitignoreCreated),
      committed: Boolean(result.committed),
      ...(result.commitSha ? { commitSha: result.commitSha } : {}),
    },
  };
}

/**
 * @param {string} boardId
 * @returns {Promise<{
 *   ok: boolean,
 *   path?: string,
 *   branch?: string,
 *   error?: string,
 *   output?: string,
 *   deps?: { ok: boolean, linked?: string[], repaired?: string[], failed?: Array<{ dir: string, reason: string }> },
 *   gitInitialized?: Record<string, unknown>,
 * }>}
 */
export async function ensureBoardIntegration(boardId) {
  // Manual card Start never calls `preflight()`, so the first worktree allocate
  // is what must refuse a non-git workspace.
  const git = await ensureBoardWorkspaceGit();
  if (!git.ok) {
    return { ok: false, error: git.error };
  }
  if (ensuredBoards.has(boardId)) {
    const intPath = getWorktreeSlotPath(boardId, INTEGRATION_SLOT);
    try {
      await fs.access(intPath);
      // The cache skips the git round-trip, not dep repair. Task worktrees
      // chain their node_modules off integration; a link that broke after the
      // first allocate must be healed before the next task starts.
      const deps = await ensureDependencyDirs(getWorkspaceRoot(), intPath);
      return {
        ok: true,
        path: intPath,
        branch: integrationBranch(boardId),
        deps,
        ...(git.event ? { gitInitialized: git.event } : {}),
      };
    } catch {
      ensuredBoards.delete(boardId);
    }
  }
  const result = await ensureIntegration({
    boardId,
    branch: integrationBranch(boardId),
  });
  if (result.ok) ensuredBoards.add(boardId);
  return git.event ? { ...result, gitInitialized: git.event } : result;
}

/**
 * Allocate (or reuse) a worktree for one attempt. The process does not exist
 * until this resolves, which is what licenses `task.attempt.started`.
 *
 * @param {{
 *   boardId: string,
 *   taskId: string,
 *   attemptId: string,
 *   desired: import('./core/types').Desired,
 *   state: import('./core/types').BoardState,
 * }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   path?: string,
 *   slotId?: string,
 *   created?: boolean,
 *   discarded: Record<string, unknown>[],
 *   gitInitialized?: Record<string, unknown>,
 *   error?: string,
 * }>}
 */
export async function allocateAttemptWorktree(input) {
  const { boardId, taskId, attemptId, desired, state } = input;
  /** @type {Record<string, unknown>[]} */
  const discarded = [];

  const integration = await ensureBoardIntegration(boardId);
  if (!integration.ok) {
    return {
      ok: false,
      discarded,
      error: integration.output || integration.error || 'ensureIntegration failed',
    };
  }
  const gitInitialized = integration.gitInitialized;

  const reuse = wantsReuse(desired);
  const previous = previousWorktreeForTask(state, taskId);

  if (reuse && previous) {
    const slotId = slotIdFromWorktreePath(boardId, previous) ?? slotIdForAttempt(attemptId);
    try {
      await fs.access(previous);
      // Do not call `createWorktree` on a live repair tree — that merges the
      // integration tip in and can clobber the dirty work being repaired.
      return {
        ok: true,
        path: previous,
        slotId,
        created: false,
        discarded,
        ...(gitInitialized ? { gitInitialized } : {}),
      };
    } catch {
      // Crash between end and retry: recreate at the same slot so the path
      // the journal records still matches the previous attempt.
      const created = await createWorktree({
        boardId,
        slotId,
        branch: attemptBranch(boardId, slotId),
        baseRef: integrationBranch(boardId),
      });
      if (!created.ok) {
        return {
          ok: false,
          discarded,
          error: created.output || created.error || 'createWorktree failed',
        };
      }
      return {
        ok: true,
        path: created.path,
        slotId,
        created: true,
        discarded,
        ...(gitInitialized ? { gitInitialized } : {}),
      };
    }
  }

  // Fresh: release the previous tree for this task first. Two attempts of the
  // same task never overlap, so this cannot yank a live path.
  if (previous) {
    const prevSlot = slotIdFromWorktreePath(boardId, previous);
    if (prevSlot && prevSlot !== INTEGRATION_SLOT) {
      const released = await releaseWorktree({
        boardId,
        slotId: prevSlot,
        taskId,
        worktree: previous,
      });
      if (released.discarded) discarded.push(released.discarded);
    }
  }

  const slotId = slotIdForAttempt(attemptId);
  const created = await createWorktree({
    boardId,
    slotId,
    branch: attemptBranch(boardId, slotId),
    baseRef: integrationBranch(boardId),
  });
  if (!created.ok) {
    return {
      ok: false,
      discarded,
      error: created.output || created.error || 'createWorktree failed',
    };
  }
  return {
    ok: true,
    path: created.path,
    slotId,
    created: true,
    discarded,
    ...(gitInitialized ? { gitInitialized } : {}),
  };
}

/**
 * @param {{ boardId: string, slotId: string, message?: string }} input
 */
export async function commitAttemptWorktree(input) {
  return commitWorktree({
    boardId: input.boardId,
    slotId: input.slotId,
    message: input.message || 'Board attempt',
  });
}

/**
 * Remove a slot after a dirty check. Dirty state is returned so the caller can
 * journal it — never dropped silently.
 *
 * @param {{
 *   boardId: string,
 *   slotId: string,
 *   taskId?: string | null,
 *   attemptId?: string,
 *   worktree?: string,
 * }} input
 * @returns {Promise<{ ok: boolean, discarded: Record<string, unknown> | null, error?: string }>}
 */
export async function releaseWorktree(input) {
  const { boardId, slotId } = input;
  const dirty = await checkWorktreeDirty({ boardId, slotId });
  /** @type {Record<string, unknown> | null} */
  let discarded = null;
  if (dirty.ok && dirty.dirty) {
    discarded = {
      worktree: input.worktree || getWorktreeSlotPath(boardId, slotId),
      files: dirty.files ?? [],
      slotId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    };
  }
  const removed = await removeWorktree({ boardId, slotId });
  return { ok: Boolean(removed.ok), discarded, error: removed.error };
}

/**
 * `git worktree list` minus journal-live, scoped to this board's directory.
 * Never removes a path the journal says is live, and never touches integration.
 *
 * @param {{ boardId: string, livePaths: Set<string> | Iterable<string> }} input
 * @returns {Promise<{ removed: string[], discarded: Record<string, unknown>[] }>}
 */
export async function reconcileOrphanWorktrees(input) {
  const { boardId } = input;
  const dir = getBoardWorktreesDir(boardId);
  try {
    await fs.access(dir);
  } catch {
    return { removed: [], discarded: [] };
  }

  const listed = await listWorktrees();
  const all = listed.ok ? parseWorktreePorcelain(listed.output) : [];
  const live = input.livePaths instanceof Set
    ? input.livePaths
    : new Set([...input.livePaths].map(normalizePath));

  /** @type {string[]} */
  const removed = [];
  /** @type {Record<string, unknown>[]} */
  const discarded = [];

  for (const wt of all) {
    if (!isUnderBoard(dir, wt)) continue;
    const slotId = slotIdFromWorktreePath(boardId, wt);
    if (!slotId || slotId === INTEGRATION_SLOT) continue;
    if ([...live].some((p) => pathsEqual(p, wt))) continue;
    const result = await releaseWorktree({ boardId, slotId, worktree: wt });
    if (result.discarded) discarded.push(result.discarded);
    if (result.ok) removed.push(wt);
  }
  return { removed, discarded };
}

/**
 * @param {string} boardDir
 * @param {string} wtPath
 * @returns {boolean}
 */
function isUnderBoard(boardDir, wtPath) {
  const rel = path.relative(normalizePath(boardDir), normalizePath(wtPath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Hook for the merge queue (P3-C). Call after a real integration merge so the
 * next worktree does not start from stale manifests. P3-A does not merge.
 *
 * @param {{ boardId: string, sinceSha?: string }} input
 */
export async function refreshIntegrationDepsAfterMerge(input) {
  return refreshIntegrationDeps({ boardId: input.boardId, sinceSha: input.sinceSha });
}

/** Test seam: isolation across MINNOW_HOME moves must not skip a real ensure. */
export function resetEnsuredBoards() {
  ensuredBoards.clear();
}
