/**
 * Line-level add/delete counts for file-mutation tools (GitHub-style stats).
 */

import { diffLines } from 'diff';

/** Normalize line endings and trailing whitespace before compare. */
export function normalizeDiffText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

/**
 * Count added and removed lines between two file bodies.
 * @param {string} before
 * @param {string} after
 * @returns {{ additions: number; deletions: number }}
 */
export function countLineChangeStats(before, after) {
  const parts = diffLines(normalizeDiffText(before), normalizeDiffText(after), {
    newlineIsToken: false,
  });
  let additions = 0;
  let deletions = 0;
  for (const part of parts) {
    const lines = part.value.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (part.added) additions += lines.length;
    else if (part.removed) deletions += lines.length;
  }
  return { additions, deletions };
}

/** Line count for normalized text (empty string → 0). */
export function countLinesInText(text) {
  const normalized = normalizeDiffText(text);
  if (!normalized) return 0;
  return normalized.split('\n').length;
}

/** Append-only mutation: additions = inserted lines, deletions = 0. */
export function countAppendLineStats(content) {
  return { additions: countLinesInText(content), deletions: 0 };
}

/**
 * Build optional codeChange payload when stats are non-zero.
 * @param {string} before
 * @param {string} after
 * @param {string} relativePath
 * @returns {{ additions: number; deletions: number; path: string } | undefined}
 */
export function codeChangeFromDiff(before, after, relativePath) {
  const { additions, deletions } = countLineChangeStats(before, after);
  if (additions === 0 && deletions === 0) return undefined;
  return { additions, deletions, path: relativePath };
}
