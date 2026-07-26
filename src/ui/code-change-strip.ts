/**
 * Composer strip: cumulative +/− line stats for the active chat.
 * Click opens a panel listing each touched file with per-file stats and diffs.
 */

import type { Chat, ChatCodeChangeTotals } from '../types';
import { basename } from './file-tree-path';
import { renderUnifiedPromptDiff } from './prompt-diff-unified';
import {
  formatCodeChangeTotalsText,
  getPerFileChangeSummary,
  hasCodeChangeTotals,
  type FileChangeSummary,
} from '../usage/code-change-ledger';

let _currentChat: Chat | null = null;
let _panelOpen = false;
let _stripInitialized = false;

/** Chevron SVG for per-file diff expand/collapse. */
const CHEVRON_SVG =
  '<svg class="icon-svg code-change-panel__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

function getStripElements(): {
  wrap: HTMLElement | null;
  strip: HTMLButtonElement | null;
  panel: HTMLElement | null;
  list: HTMLElement | null;
  statsEl: HTMLElement | null;
} {
  return {
    wrap: document.querySelector('.code-change-strip-wrap'),
    strip: document.getElementById('codeChangeStrip') as HTMLButtonElement | null,
    panel: document.getElementById('codeChangePanel'),
    list: document.getElementById('codeChangePanelList'),
    statsEl: document.getElementById('codeChangeStripStats'),
  };
}

/** Append green + / red − spans (shared by composer strip and sidebar stats). */
export function appendCodeChangeTotalsSpans(
  parent: Node,
  totals: ChatCodeChangeTotals,
): void {
  const addSpan = document.createElement('span');
  addSpan.className = 'code-change-strip__add';
  addSpan.textContent = `+${totals.additions}`;
  const delSpan = document.createElement('span');
  delSpan.className = 'code-change-strip__del';
  delSpan.textContent = `−${totals.deletions}`;
  parent.appendChild(addSpan);
  parent.appendChild(document.createTextNode(' '));
  parent.appendChild(delSpan);
}

/** Build the strip stats row: file count plus +/− totals. */
function renderStripStats(
  statsEl: HTMLElement,
  fileCount: number,
  totals: ChatCodeChangeTotals,
): void {
  const frag = document.createDocumentFragment();

  if (fileCount > 0) {
    const filesSpan = document.createElement('span');
    filesSpan.className = 'code-change-strip__files';
    filesSpan.textContent = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
    frag.appendChild(filesSpan);
    frag.appendChild(document.createTextNode(' '));
  }

  appendCodeChangeTotalsSpans(frag, totals);
  statsEl.replaceChildren(frag);
}

/** Create +/− badge for a file row. */
function createFileStatsBadge(summary: FileChangeSummary): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'code-change-panel__file-stats';

  if (summary.additions > 0) {
    const add = document.createElement('span');
    add.className = 'code-change-strip__add';
    add.textContent = `+${summary.additions}`;
    badge.appendChild(add);
  }
  if (summary.deletions > 0) {
    if (summary.additions > 0) badge.appendChild(document.createTextNode(' '));
    const del = document.createElement('span');
    del.className = 'code-change-strip__del';
    del.textContent = `−${summary.deletions}`;
    badge.appendChild(del);
  }

  return badge;
}

/** Mount inline unified diffs for one file row. */
function renderFileDiffChunks(host: HTMLElement, summary: FileChangeSummary): void {
  host.replaceChildren();
  for (const chunk of summary.diffChunks) {
    const chunkHost = document.createElement('div');
    chunkHost.className = 'code-change-panel__file-diff-chunk';
    renderUnifiedPromptDiff(chunkHost, chunk.lines);
    host.appendChild(chunkHost);
    if (chunk.truncated) {
      const note = document.createElement('p');
      note.className = 'settings-field-hint prompt-diff__truncated';
      note.textContent = 'Diff truncated for display.';
      host.appendChild(note);
    }
  }
}

/** Build one clickable file row in the panel list. */
function createFileRow(summary: FileChangeSummary): HTMLElement {
  const row = document.createElement('div');
  row.className = 'code-change-panel__file';

  const hasDiff = summary.diffChunks.length > 0;
  const header = document.createElement('div');
  header.className = 'code-change-panel__file-header';

  if (hasDiff) {
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'code-change-panel__file-expand';
    expandBtn.setAttribute('aria-label', `Show diff for ${summary.path}`);
    expandBtn.setAttribute('aria-expanded', 'false');
    expandBtn.innerHTML = CHEVRON_SVG;
    header.appendChild(expandBtn);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'code-change-panel__file-expand-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    header.appendChild(spacer);
  }

  const pathBtn = document.createElement('button');
  pathBtn.type = 'button';
  pathBtn.className = 'code-change-panel__file-path';
  pathBtn.title = summary.path;
  pathBtn.textContent = basename(summary.path);
  pathBtn.setAttribute('aria-label', `Open ${summary.path}`);
  header.appendChild(pathBtn);
  header.appendChild(createFileStatsBadge(summary));
  row.appendChild(header);

  let diffHost: HTMLElement | null = null;
  if (hasDiff) {
    diffHost = document.createElement('div');
    diffHost.className = 'code-change-panel__file-diff';
    diffHost.hidden = true;
    row.appendChild(diffHost);

    const expandBtn = header.querySelector('.code-change-panel__file-expand') as HTMLButtonElement;
    expandBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!diffHost) return;
      const expanded = Boolean(diffHost.hidden);
      diffHost.hidden = !expanded;
      expandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      expandBtn.classList.toggle('is-expanded', expanded);
      if (expanded && diffHost.childElementCount === 0) {
        renderFileDiffChunks(diffHost, summary);
      }
    });
  }

  pathBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void import('./file-viewer').then((m) => m.openFileInViewer(summary.path));
  });

  return row;
}

/** Populate the panel list from the active chat history. */
function populateCodeChangePanel(): void {
  const { list } = getStripElements();
  if (!list || !_currentChat) return;

  const summaries = getPerFileChangeSummary(_currentChat);
  if (summaries.length === 0) {
    list.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'code-change-panel__empty';
    empty.textContent = 'No file changes recorded.';
    list.appendChild(empty);
    return;
  }

  list.replaceChildren(...summaries.map(createFileRow));
}

/** Close the upward file-list panel. */
export function closeCodeChangePanel(): void {
  const { strip, panel } = getStripElements();
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  _panelOpen = false;
  strip?.setAttribute('aria-expanded', 'false');
}

/** Open the panel and rebuild its file list. */
export function openCodeChangePanel(): void {
  const { strip, panel } = getStripElements();
  if (!panel || !strip || strip.classList.contains('hidden')) return;
  populateCodeChangePanel();
  panel.hidden = false;
  _panelOpen = true;
  strip.setAttribute('aria-expanded', 'true');
}

/** Toggle the file-list panel open or closed. */
export function toggleCodeChangePanel(): void {
  if (_panelOpen) closeCodeChangePanel();
  else openCodeChangePanel();
}

/** Wire strip click, outside dismiss, and Escape once at app boot. */
export function initCodeChangeStrip(): void {
  if (_stripInitialized) return;
  _stripInitialized = true;

  const { strip, wrap } = getStripElements();
  if (!strip) return;

  strip.addEventListener('click', () => {
    toggleCodeChangePanel();
  });

  document.addEventListener('mousedown', (event) => {
    if (!_panelOpen) return;
    const target = event.target as Node;
    if (wrap?.contains(target)) return;
    closeCodeChangePanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && _panelOpen) closeCodeChangePanel();
  });
}

/** Show or hide the strip above the input bar from chat totals. */
export function updateCodeChangeStrip(chat?: Chat | null): void {
  const { strip, statsEl } = getStripElements();
  if (!strip || !statsEl) return;

  _currentChat = chat ?? null;
  closeCodeChangePanel();

  const totals = chat?.codeChangeTotals;
  if (!hasCodeChangeTotals(totals) || !totals || !chat) {
    strip.classList.add('hidden');
    statsEl.textContent = '';
    strip.setAttribute('aria-label', 'Code changes in this chat');
    return;
  }

  const fileCount = getPerFileChangeSummary(chat).length;
  strip.classList.remove('hidden');
  renderStripStats(statsEl, fileCount, totals);
  strip.setAttribute(
    'aria-label',
    `Code changes in this chat: ${fileCount} file${fileCount === 1 ? '' : 's'}, ${formatCodeChangeTotalsText(totals)}`,
  );
}
