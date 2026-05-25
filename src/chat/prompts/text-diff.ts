/**
 * Line-level diff helpers for prompt compare UI (testable, no DOM).
 */

import { diffLines } from 'diff';

export type DiffLineType = 'unchanged' | 'add' | 'remove';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** Normalize line endings and trailing whitespace before compare. */
export function normalizePromptDiffText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

/** True when baseline and current are equal after normalization. */
export function promptsMatchForDiff(baseline: string, current: string): boolean {
  return normalizePromptDiffText(baseline) === normalizePromptDiffText(current);
}

/**
 * Build unified diff lines: removed (baseline-only), added (current-only), unchanged.
 */
export function buildLineDiff(baseline: string, current: string): DiffLine[] {
  const parts = diffLines(
    normalizePromptDiffText(baseline),
    normalizePromptDiffText(current),
    { newlineIsToken: false },
  );
  const out: DiffLine[] = [];
  for (const part of parts) {
    const lines = part.value.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    const type: DiffLineType = part.added
      ? 'add'
      : part.removed
        ? 'remove'
        : 'unchanged';
    for (const line of lines) {
      out.push({ type, text: line });
    }
  }
  return out;
}
