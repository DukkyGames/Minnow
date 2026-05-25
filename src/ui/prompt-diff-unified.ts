/**
 * Render unified prompt diff lines into a host element.
 */

import type { DiffLine } from '../chat/prompts/text-diff';

const MAX_DIFF_LINES = 2000;

export function renderUnifiedPromptDiff(host: HTMLElement, lines: DiffLine[]): void {
  host.replaceChildren();
  host.classList.add('prompt-diff', 'prompt-diff--unified');

  if (lines.length > MAX_DIFF_LINES) {
    const note = document.createElement('p');
    note.className = 'settings-field-hint prompt-diff__truncated';
    note.textContent = `Showing first ${MAX_DIFF_LINES} of ${lines.length} diff lines.`;
    host.appendChild(note);
  }

  const slice = lines.slice(0, MAX_DIFF_LINES);
  const pre = document.createElement('pre');
  pre.className = 'prompt-diff__body';

  for (const line of slice) {
    const row = document.createElement('div');
    row.className = `prompt-diff__line prompt-diff__line--${line.type}`;
    const prefix = document.createElement('span');
    prefix.className = 'prompt-diff__prefix';
    prefix.textContent = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
    const text = document.createElement('span');
    text.className = 'prompt-diff__text';
    text.textContent = line.text || ' ';
    row.appendChild(prefix);
    row.appendChild(text);
    pre.appendChild(row);
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
