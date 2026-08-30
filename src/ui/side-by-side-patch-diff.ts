/**
 * Aligned side-by-side diff rows from a single-file unified patch (VS Code style).
 */

export type SideCellKind = 'context' | 'add' | 'remove' | 'gap';

export interface SideCell {
  lineNumber: number | null;
  text: string;
  kind: SideCellKind;
}

export interface SideBySideRow {
  left: SideCell;
  right: SideCell;
}

interface HunkLine {
  type: 'context' | 'add' | 'remove';
  text: string;
}

interface ParsedHunk {
  oldStart: number;
  newStart: number;
  lines: HunkLine[];
}

const MAX_RENDER_ROWS = 4000;

/** Parse @@ hunks and body lines from one file patch. */
function parsePatchHunks(patch: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;

  for (const raw of String(patch ?? '').split('\n')) {
    if (raw.startsWith('@@')) {
      const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      current = {
        oldStart: match ? Number(match[1]) : 1,
        newStart: match ? Number(match[2]) : 1,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) current.lines.push({ type: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) current.lines.push({ type: 'remove', text: raw.slice(1) });
    else if (raw.startsWith(' ')) current.lines.push({ type: 'context', text: raw.slice(1) });
  }

  return hunks;
}

/** Pair buffered removes/adds into aligned rows with optional gap cells. */
function flushChangeBuffers(
  removes: string[],
  adds: string[],
  oldNum: number,
  newNum: number,
  rows: SideBySideRow[],
): { oldNum: number; newNum: number } {
  const count = Math.max(removes.length, adds.length);
  for (let i = 0; i < count; i++) {
    const removeText = removes[i];
    const addText = adds[i];
    if (removeText !== undefined && addText !== undefined) {
      rows.push({
        left: { lineNumber: oldNum++, text: removeText, kind: 'remove' },
        right: { lineNumber: newNum++, text: addText, kind: 'add' },
      });
      continue;
    }
    if (removeText !== undefined) {
      rows.push({
        left: { lineNumber: oldNum++, text: removeText, kind: 'remove' },
        right: { lineNumber: null, text: '', kind: 'gap' },
      });
      continue;
    }
    if (addText !== undefined) {
      rows.push({
        left: { lineNumber: null, text: '', kind: 'gap' },
        right: { lineNumber: newNum++, text: addText, kind: 'add' },
      });
    }
  }
  return { oldNum, newNum };
}

/** Turn one hunk into aligned left/right rows with independent line numbers. */
export function alignHunkLines(hunk: ParsedHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let oldNum = hunk.oldStart;
  let newNum = hunk.newStart;
  let removeBuf: string[] = [];
  let addBuf: string[] = [];

  const flush = () => {
    const next = flushChangeBuffers(removeBuf, addBuf, oldNum, newNum, rows);
    oldNum = next.oldNum;
    newNum = next.newNum;
    removeBuf = [];
    addBuf = [];
  };

  for (const line of hunk.lines) {
    if (line.type === 'context') {
      flush();
      rows.push({
        left: { lineNumber: oldNum++, text: line.text, kind: 'context' },
        right: { lineNumber: newNum++, text: line.text, kind: 'context' },
      });
      continue;
    }
    if (line.type === 'remove') removeBuf.push(line.text);
    else addBuf.push(line.text);
  }

  flush();
  return rows;
}

/** Build aligned rows for an entire single-file patch. */
export function buildSideBySideRowsFromPatch(patch: string): SideBySideRow[] {
  const rows: ParsedHunk[] = parsePatchHunks(patch);
  return rows.flatMap((hunk) => alignHunkLines(hunk));
}

function formatLineNumber(num: number | null): string {
  return num == null ? '' : String(num);
}

function mountCell(
  parent: HTMLElement,
  tag: 'span',
  className: string,
  text: string,
): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text || '\u00a0';
  parent.appendChild(el);
  return el;
}

export interface RenderSideBySidePatchDiffOptions {
  /** When true, long lines wrap inside each column (MIN-675). Default false. */
  wordWrap?: boolean;
}

/** Apply or clear the wrap class on a mounted side-by-side host. */
export function setSideBySidePatchDiffWordWrap(host: HTMLElement, wordWrap: boolean): void {
  host.classList.toggle('sbs-diff--wrap', wordWrap);
}

/** Render aligned side-by-side diff into `host` (scrolls as one surface). */
export function renderSideBySidePatchDiff(
  host: HTMLElement,
  patch: string,
  options: RenderSideBySidePatchDiffOptions = {},
): void {
  host.replaceChildren();
  host.classList.add('sbs-diff');
  // Word wrap keeps long commit-review lines in view instead of forcing sideways scroll.
  setSideBySidePatchDiffWordWrap(host, options.wordWrap === true);

  const allRows = buildSideBySideRowsFromPatch(patch);
  const truncated = allRows.length > MAX_RENDER_ROWS;
  const displayRows = truncated ? allRows.slice(0, MAX_RENDER_ROWS) : allRows;

  if (truncated) {
    const note = document.createElement('p');
    note.className = 'sbs-diff__truncated';
    note.textContent = `Showing first ${MAX_RENDER_ROWS} of ${allRows.length} diff lines.`;
    host.appendChild(note);
  }

  const scroll = document.createElement('div');
  scroll.className = 'sbs-diff__scroll';

  const grid = document.createElement('div');
  grid.className = 'sbs-diff__grid';

  for (const row of displayRows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'sbs-diff__row';

    mountCell(rowEl, 'span', `sbs-diff__gutter sbs-diff__gutter--left`, formatLineNumber(row.left.lineNumber));
    mountCell(
      rowEl,
      'span',
      `sbs-diff__cell sbs-diff__cell--left sbs-diff__cell--${row.left.kind}`,
      row.left.text,
    );
    mountCell(rowEl, 'span', `sbs-diff__gutter sbs-diff__gutter--right`, formatLineNumber(row.right.lineNumber));
    mountCell(
      rowEl,
      'span',
      `sbs-diff__cell sbs-diff__cell--right sbs-diff__cell--${row.right.kind}`,
      row.right.text,
    );

    grid.appendChild(rowEl);
  }

  scroll.appendChild(grid);
  host.appendChild(scroll);
}
