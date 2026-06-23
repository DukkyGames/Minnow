/**
 * Parse unified diff patch text into DiffLine rows for inline viewers.
 */

import type { DiffLine } from '../chat/prompts/text-diff';

/** Parse unified diff hunk lines (after @@ headers) into DiffLine[]. */
export function parseUnifiedPatchToDiffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let inHunk = false;

  for (const raw of String(patch ?? '').split('\n')) {
    if (raw.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\')) continue;

    if (raw.startsWith('+')) {
      lines.push({ type: 'add', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'remove', text: raw.slice(1) });
    } else if (raw.startsWith(' ')) {
      lines.push({ type: 'unchanged', text: raw.slice(1) });
    }
  }

  return lines;
}
