/**
 * Compact file + line-range links (composer chips and user message bubbles).
 */

import { formatCodeRefLabel } from '../attachments/code-ref-format';

export interface CodeRefLinkTarget {
  workspacePath: string;
  startLine: number;
  endLine: number;
}

/** Open the workspace file and select the 1-based line range in CodeMirror. */
export function openCodeRefInViewer(target: CodeRefLinkTarget): void {
  void import('./file-viewer').then((m) => {
    void m.openFileInViewer(target.workspacePath, {
      initialLineRange: {
        startLine: target.startLine,
        endLine: target.endLine,
      },
    });
  });
}

/** Build a clickable code-reference control (Cursor-style path + L15-36). */
export function createCodeRefLinkButton(
  target: CodeRefLinkTarget,
  options?: { className?: string },
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = options?.className ?? 'code-ref-link';
  const label = formatCodeRefLabel(
    target.workspacePath,
    target.startLine,
    target.endLine,
  );
  const fileName = label.replace(/\s+L\d+(-\d+)?$/, '');
  const linePart = label.slice(fileName.length).trim();

  btn.title = `Open ${target.workspacePath} ${linePart}`;
  btn.setAttribute('aria-label', `Open ${target.workspacePath} ${linePart}`);

  const icon = document.createElement('span');
  icon.className = 'code-ref-link__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '<>';
  btn.appendChild(icon);

  const nameEl = document.createElement('span');
  nameEl.className = 'code-ref-link__name';
  nameEl.textContent = fileName;
  btn.appendChild(nameEl);

  if (linePart) {
    const linesEl = document.createElement('span');
    linesEl.className = 'code-ref-link__lines';
    linesEl.textContent = linePart;
    btn.appendChild(linesEl);
  }

  btn.addEventListener('click', () => openCodeRefInViewer(target));
  return btn;
}
