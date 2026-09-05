/** Expand touches globs and detect overflow writes. */

import { runProcess } from '../process-runner.js';
import { capDiffText } from './core/evidence.js';
import { expandTouches, overflowPaths } from './core/plan.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

const GIT_TIMEOUT_MS = 60_000;

/**
 * @param {string[]} args
 * @param {string} cwd
 */
async function git(args, cwd) {
  return runProcess('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
}

/**
 * @param {string | undefined} stdout
 * @returns {string[]}
 */
function parseNul(stdout) {
  return String(stdout ?? '')
    .split('\0')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Tracked and untracked (non-ignored) paths at the workspace root, repo-relative.
 *
 * @param {string} [root]
 * @returns {Promise<string[]>}
 */
export async function listRepoFiles(root = getEffectiveWorkspaceRoot()) {
  const listed = await git(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    root,
  );
  if (listed.code !== 0) return [];
  return [...new Set(parseNul(listed.stdout))].sort();
}

/**
 * Stamp each plan task with the expansion that `plan()` will replay.
 *
 * @param {Array<Record<string, unknown> & { touches?: string[] }>} tasks
 * @param {readonly string[]} repoFiles
 * @returns {Array<Record<string, unknown>>}
 */
export function attachTouchesExpansion(tasks, repoFiles) {
  return (tasks ?? []).map((task) => {
    const globs = Array.isArray(task.touches) ? task.touches.map(String) : [];
    const { expanded, emptyGlobs } = expandTouches(globs, repoFiles);
    return {
      ...task,
      touchesExpanded: expanded,
      emptyTouchesGlobs: emptyGlobs,
    };
  });
}

/**
 * Files this worktree changed relative to the integration (or first parent) plus anything still uncommitted.
 * @param {string} worktree
 * @param {string} [baseRef]
 * @returns {Promise<string[]>}
 */
export async function listChangedFiles(worktree, baseRef) {
  if (!worktree) return [];
  /** @type {Set<string>} */
  const paths = new Set();

  const base = await resolveDiffBase(worktree, baseRef);
  if (base) {
    const committed = await git(['diff', '--name-only', '-z', base, 'HEAD'], worktree);
    if (committed.code === 0) {
      for (const file of parseNul(committed.stdout)) paths.add(file);
    }
  }

  const unstaged = await git(['diff', '--name-only', '-z', 'HEAD'], worktree);
  if (unstaged.code === 0) {
    for (const file of parseNul(unstaged.stdout)) paths.add(file);
  }
  const untracked = await git(['ls-files', '-z', '--others', '--exclude-standard'], worktree);
  if (untracked.code === 0) {
    for (const file of parseNul(untracked.stdout)) paths.add(file);
  }

  return [...paths].sort();
}

/**
 * Resolve the same merge-base `listChangedFiles` uses so overflow and the abandonment patch describe the same tree.
 * @param {string} worktree
 * @param {string} [baseRef]
 * @returns {Promise<string>}
 */
async function resolveDiffBase(worktree, baseRef) {
  if (baseRef) {
    const mb = await git(['merge-base', 'HEAD', baseRef], worktree);
    if (mb.code === 0) {
      const sha = String(mb.stdout ?? '').trim();
      if (sha) return sha;
    }
  }
  const parent = await git(['rev-parse', '--verify', 'HEAD^'], worktree);
  if (parent.code === 0) return String(parent.stdout ?? '').trim();
  return '';
}

/**
 * Unified diff of this worktree relative to integration (or first parent), plus unstaged changes.
 * @param {string} worktree
 * @param {string} [baseRef]
 * @returns {Promise<{ files: string[], patch: string, truncated: boolean, originalLength?: number } | null>}
 */
export async function captureWorktreeDiff(worktree, baseRef) {
  if (!worktree) return null;
  const files = await listChangedFiles(worktree, baseRef);
  const base = await resolveDiffBase(worktree, baseRef);
  /** @type {string[]} */
  const chunks = [];
  if (base) {
    const committed = await git(['diff', '--unified=3', base, 'HEAD'], worktree);
    if (committed.code === 0 && committed.stdout) chunks.push(String(committed.stdout));
  }
  const unstaged = await git(['diff', '--unified=3', 'HEAD'], worktree);
  if (unstaged.code === 0 && unstaged.stdout) chunks.push(String(unstaged.stdout));
  const capped = capDiffText(chunks.join('\n'));
  if (files.length === 0 && !capped.text) return null;
  /** @type {{ files: string[], patch: string, truncated: boolean, originalLength?: number }} */
  const out = { files, patch: capped.text, truncated: capped.truncated };
  if (capped.originalLength != null) out.originalLength = capped.originalLength;
  return out;
}

/**
 * Compare a passing attempt's worktree diff to its declared globs.
 *
 * @param {{
 *   worktree: string | null | undefined,
 *   declared: readonly string[],
 *   baseRef?: string,
 * }} input
 * @returns {Promise<{ declared: string[], actual: string[] } | null>}
 */
export async function detectAttemptOverflow(input) {
  const worktree = input.worktree;
  const declared = input.declared ?? [];
  if (!worktree || declared.length === 0) return null;
  const actual = await listChangedFiles(worktree, input.baseRef);
  const extra = overflowPaths(declared, actual);
  if (extra.length === 0) return null;
  return { declared: [...declared], actual: extra };
}
