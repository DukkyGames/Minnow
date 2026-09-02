import { diffLines } from 'diff';

export type DiffLineType = 'unchanged' | 'add' | 'remove';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** Add/remove row with a 1-based line number in the post-edit file (add) or pre-edit file (remove). */
export interface NumberedChangeLine {
  type: 'add' | 'remove';
  text: string;
  lineNumber: number;
}

/**
 * Keep only edited lines and attach line numbers by walking the full unified diff.
 */
export function toChangedLinesWithNumbers(lines: DiffLine[]): NumberedChangeLine[] {
  const out: NumberedChangeLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const line of lines) {
    if (line.type === 'unchanged') {
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (line.type === 'remove') {
      out.push({ type: 'remove', text: line.text, lineNumber: oldLine });
      oldLine += 1;
      continue;
    }
    out.push({ type: 'add', text: line.text, lineNumber: newLine });
    newLine += 1;
  }
  return out;
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

/** GitHub-style line add/delete counts (same normalization as {@link buildLineDiff}). */
export function countLineChangeStats(
  baseline: string,
  current: string,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of buildLineDiff(baseline, current)) {
    if (line.type === 'add') additions += 1;
    else if (line.type === 'remove') deletions += 1;
  }
  return { additions, deletions };
}
