/** Serialized rebase-then-merge step. */

import {
  abortMerge,
  mergeIntoIntegration,
  readIntegrationRef,
  rebaseOntoIntegration,
  restoreIntegration,
  verifyIntegrationMerge,
} from '../worktree/worktree-ops.js';
import {
  attemptBranch,
  previousWorktreeForTask,
  refreshIntegrationDepsAfterMerge,
  slotIdFromWorktreePath,
} from './worktree-lifecycle.js';

/**
 * Git ops the queue calls.
 * @typedef {object} MergeQueueOps
 * @property {(input: { boardId: string, ref?: string }) => Promise<string | null>} readIntegrationRef
 * @property {(input: { boardId: string }) => Promise<{ ok: boolean, output?: string }>} abortMerge
 * @property {(input: { boardId: string, slotId: string }) => Promise<{ ok: true, sha: string } | { ok: false, conflicts: string[], error?: string }>} rebaseOntoIntegration
 * @property {(input: { boardId: string, fromBranch: string, message?: string }) => Promise<{ ok: boolean, conflict?: boolean, conflictedFiles?: string[], error?: string, output?: string }>} mergeIntoIntegration
 * @property {(input: { boardId: string, fromBranch: string }) => Promise<{ ok: boolean, verified?: boolean, reasons?: string[], error?: string }>} verifyIntegrationMerge
 * @property {(input: { boardId: string, sha: string }) => Promise<{ ok: boolean, sha?: string, error?: string, output?: string }>} restoreIntegration
 * @property {(input: { boardId: string, sinceSha?: string }) => Promise<unknown>} refreshIntegrationDepsAfterMerge
 */

/** @type {MergeQueueOps} */
const builtinOps = {
  readIntegrationRef,
  abortMerge,
  rebaseOntoIntegration,
  mergeIntoIntegration,
  verifyIntegrationMerge,
  restoreIntegration,
  refreshIntegrationDepsAfterMerge,
};

/**
 * @param {Partial<MergeQueueOps> | undefined} overlay
 * @returns {MergeQueueOps}
 */
function resolveOps(overlay) {
  if (!overlay) return builtinOps;
  return { ...builtinOps, ...overlay };
}

/**
 * @param {{
 *   attemptId: string,
 *   taskId: string | null,
 *   files: string[],
 *   beforeSha?: string,
 *   summary?: string,
 * }} input
 * @returns {import('./engine.js').AttemptEnd}
 */
function conflictedEnd(input) {
  /** @type {import('./engine.js').AttemptEnd} */
  const end = {
    attemptId: input.attemptId,
    taskId: input.taskId,
    role: 'merge',
    outcome: 'conflicted',
    files: input.files,
  };
  if (input.beforeSha) end.beforeSha = input.beforeSha;
  if (input.summary) end.summary = input.summary;
  return end;
}

/**
 * Turn verify-failure reasons into a file list the rebase seed can quote.
 * @param {{ reasons?: string[], error?: string } | null | undefined} verified
 * @returns {string[]}
 */
function filesFromVerify(verified) {
  const reasons = Array.isArray(verified?.reasons) ? verified.reasons : [];
  /** @type {string[]} */
  const files = [];
  for (const reason of reasons) {
    const match = String(reason).match(/conflict markers remain in:\s*(.*)$/i);
    if (match) {
      files.push(
        ...match[1]
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      );
    }
  }
  if (files.length > 0) return files;
  if (reasons.length > 0) return reasons;
  if (typeof verified?.error === 'string' && verified.error) return [verified.error];
  return ['(merge verification failed)'];
}

/**
 * Abort a half-applied integration merge so journal and git can agree.
 * @param {{ boardId: string, ops?: Partial<MergeQueueOps> }} input
 * @returns {Promise<{ recovered: boolean, beforeSha?: string | null }>}
 */
export async function recoverHalfAppliedMerge(input) {
  const { boardId } = input;
  const ops = resolveOps(input.ops);

  const mergeHead = await ops.readIntegrationRef({ boardId, ref: 'MERGE_HEAD' });
  if (!mergeHead) return { recovered: false };

  const orig = await ops.readIntegrationRef({ boardId, ref: 'ORIG_HEAD' });
  await ops.abortMerge({ boardId });

  const still = await ops.readIntegrationRef({ boardId, ref: 'MERGE_HEAD' });
  if (still && orig) {
    await ops.restoreIntegration({ boardId, sha: orig });
  }
  return { recovered: true, beforeSha: orig ?? null };
}

/**
 * Rebase the owning task onto integration, then merge.
 * @param {{
 *   boardId: string,
 *   taskId: string | null,
 *   attemptId: string,
 *   state: import('./core/types').BoardState,
 *   ops?: Partial<MergeQueueOps>,
 * }} input
 * @returns {Promise<import('./engine.js').AttemptEnd>}
 */
export async function runMerge(input) {
  const { boardId, taskId, attemptId, state } = input;
  const ops = resolveOps(input.ops);

  if (!taskId) {
    return conflictedEnd({
      attemptId,
      taskId: null,
      files: [],
      summary: 'merge requires a taskId',
    });
  }

  await recoverHalfAppliedMerge({ boardId, ops });

  const beforeSha = await ops.readIntegrationRef({ boardId, ref: 'HEAD' });
  if (!beforeSha) {
    return conflictedEnd({
      attemptId,
      taskId,
      files: [],
      summary: 'integration HEAD could not be resolved',
    });
  }

  const worktree = previousWorktreeForTask(state, taskId);
  if (!worktree) {
    return conflictedEnd({
      attemptId,
      taskId,
      files: [],
      beforeSha,
      summary: 'no builder/tester worktree recorded for this task',
    });
  }
  const slotId = slotIdFromWorktreePath(boardId, worktree);
  if (!slotId) {
    return conflictedEnd({
      attemptId,
      taskId,
      files: [],
      beforeSha,
      summary: 'worktree path is not a slot of this board',
    });
  }

  const rebased = await ops.rebaseOntoIntegration({ boardId, slotId });
  if (!rebased.ok) {
    return conflictedEnd({
      attemptId,
      taskId,
      files: Array.isArray(rebased.conflicts) ? rebased.conflicts : [],
      beforeSha,
      summary: rebased.error || 'rebase conflicted',
    });
  }

  const fromBranch = attemptBranch(boardId, slotId);
  const merged = await ops.mergeIntoIntegration({
    boardId,
    fromBranch,
    message: `merge ${taskId}`,
  });
  if (!merged.ok) {
    const files = Array.isArray(merged.conflictedFiles) ? merged.conflictedFiles : [];
    await ops.abortMerge({ boardId });
    const still = await ops.readIntegrationRef({ boardId, ref: 'MERGE_HEAD' });
    if (still) {
      await ops.restoreIntegration({ boardId, sha: beforeSha });
    }
    return conflictedEnd({
      attemptId,
      taskId,
      files,
      beforeSha,
      summary: merged.error || merged.output || 'merge conflicted',
    });
  }

  const verified = await ops.verifyIntegrationMerge({ boardId, fromBranch });
  if (!verified.ok || verified.verified === false) {
    await ops.restoreIntegration({ boardId, sha: beforeSha });
    return conflictedEnd({
      attemptId,
      taskId,
      files: filesFromVerify(verified),
      beforeSha,
      summary: (verified.reasons || []).join('; ') || verified.error || 'merge verification failed',
    });
  }

  const sha = (await ops.readIntegrationRef({ boardId, ref: 'HEAD' })) || rebased.sha;

  try {
    await ops.refreshIntegrationDepsAfterMerge({ boardId, sinceSha: beforeSha });
  } catch (err) {
    console.warn(
      `[orchestrator] ${boardId}: refreshIntegrationDepsAfterMerge failed after merging ${taskId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  /** @type {import('./engine.js').AttemptEnd} */
  const end = {
    attemptId,
    taskId,
    role: 'merge',
    outcome: 'pass',
    sha,
    beforeSha,
  };
  return end;
}
