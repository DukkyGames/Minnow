/**
 * Render unified prompt diff lines into a host element.
 */

import type { DiffLine } from '../chat/prompts/text-diff';
import { toChangedLinesWithNumbers } from '../chat/prompts/text-diff';

const MAX_DIFF_LINES = 2000;

export type UnifiedPromptDiffOptions = {
  /** Omit unchanged context lines (add/remove only). */
  changedOnly?: boolean;
  /** Show 1-based line numbers for each changed row. */
  lineNumbers?: boolean;
};

function mountDiffRow(
  pre: HTMLElement,
  type: DiffLine['type'],
  text: string,
  lineNumber?: number,
): void {
  const row = document.createElement('div');
  row.className = `prompt-diff__line prompt-diff__line--${type}`;
  if (lineNumber != null) {
    const lineno = document.createElement('span');
    lineno.className = 'prompt-diff__lineno';
    lineno.textContent = String(lineNumber);
    row.appendChild(lineno);
  }
  const prefix = document.createElement('span');
  prefix.className = 'prompt-diff__prefix';
  prefix.textContent = type === 'add' ? '+' : type === 'remove' ? '-' : ' ';
  const textEl = document.createElement('span');
  textEl.className = 'prompt-diff__text';
  textEl.textContent = text || ' ';
  row.appendChild(prefix);
  row.appendChild(textEl);
  pre.appendChild(row);
}

export function renderUnifiedPromptDiff(
  host: HTMLElement,
  lines: DiffLine[],
  options: UnifiedPromptDiffOptions = {},
): void {
  host.replaceChildren();
  host.classList.add('prompt-diff', 'prompt-diff--unified');
  if (options.lineNumbers) {
    host.classList.add('prompt-diff--numbered');
  }

  const displayLines = options.changedOnly || options.lineNumbers
    ? toChangedLinesWithNumbers(lines)
    : lines;

  if (displayLines.length > MAX_DIFF_LINES) {
    const note = document.createElement('p');
    note.className = 'settings-field-hint prompt-diff__truncated';
    note.textContent = `Showing first ${MAX_DIFF_LINES} of ${displayLines.length} diff lines.`;
    host.appendChild(note);
  }

  const slice = displayLines.slice(0, MAX_DIFF_LINES);
  const pre = document.createElement('pre');
  pre.className = 'prompt-diff__body';

  for (const line of slice) {
    if (options.changedOnly || options.lineNumbers) {
      const numbered = line as { type: 'add' | 'remove'; text: string; lineNumber: number };
      mountDiffRow(pre, numbered.type, numbered.text, options.lineNumbers ? numbered.lineNumber : undefined);
      continue;
    }
    const plain = line as DiffLine;
    mountDiffRow(pre, plain.type, plain.text);
  }

  host.appendChild(pre);
}

export function renderSideBySidePromptDiff(
  host: HTMLElement,
  baseline: string,
  current: string,
): void {
  host.replaceChildren();
  host.classList.add('prompt-diff', 'prompt-diff--side-by-side');

  const grid = document.createElement('div');
  grid.className = 'prompt-diff__columns';

  const left = document.createElement('div');
  left.className = 'prompt-diff__column';
  const leftLabel = document.createElement('div');
  leftLabel.className = 'prompt-diff__column-label';
  leftLabel.textContent = 'Shipped default';
  const leftPre = document.createElement('pre');
  leftPre.className = 'prompt-diff__column-body';
  leftPre.textContent = baseline || '(empty)';
  left.appendChild(leftLabel);
  left.appendChild(leftPre);

  const right = document.createElement('div');
  right.className = 'prompt-diff__column';
  const rightLabel = document.createElement('div');
  rightLabel.className = 'prompt-diff__column-label';
  rightLabel.textContent = 'Yours';
  const rightPre = document.createElement('pre');
  rightPre.className = 'prompt-diff__column-body';
  rightPre.textContent = current || '(empty)';
  right.appendChild(rightLabel);
  right.appendChild(rightPre);

  grid.appendChild(left);
  grid.appendChild(right);
  host.appendChild(grid);
}
