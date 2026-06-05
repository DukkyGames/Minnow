/**
 * Deep Research library list — search, sort, archive, delete, open report.
 */

import {
  archiveResearch,
  deleteResearch,
  fetchResearchLibrary,
  researchReportUrl,
} from './client';
import type { ResearchLibraryItem, ResearchLibrarySort } from './types';

export interface ResearchLibraryMountOptions {
  mount: HTMLElement;
  onOpenDetail: (id: string) => void;
  onOpenReport: (id: string) => void;
  onDiscuss: (id: string) => void;
  onRefine: (id: string, query: string) => void;
}

let searchValue = '';
let sortValue: ResearchLibrarySort = 'newest';
let showArchived = false;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: ResearchLibraryItem['status']): string {
  if (status === 'done') return 'Done';
  if (status === 'running') return 'Running';
  if (status === 'cancelled') return 'Cancelled';
  return 'Error';
}

/** Render library controls + list into the mount element. */
export async function renderResearchLibrary(options: ResearchLibraryMountOptions): Promise<void> {
  const { mount, onOpenDetail, onOpenReport, onDiscuss, onRefine } = options;
  mount.innerHTML = `
    <div class="research-library-toolbar">
      <input type="search" id="researchLibrarySearch" class="research-input" placeholder="Search queries…" aria-label="Search library" />
      <select id="researchLibrarySort" class="research-select" aria-label="Sort library">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="query">Query A–Z</option>
      </select>
      <label class="research-library-archived">
        <input type="checkbox" id="researchLibraryArchived" />
        Show archived
      </label>
    </div>
    <ul id="researchLibraryList" class="research-library-list" role="list"></ul>
    <p id="researchLibraryEmpty" class="research-library-empty hidden">No research runs yet.</p>
  `;

  const searchInput = mount.querySelector('#researchLibrarySearch') as HTMLInputElement;
  const sortSelect = mount.querySelector('#researchLibrarySort') as HTMLSelectElement;
  const archivedCheck = mount.querySelector('#researchLibraryArchived') as HTMLInputElement;
  const listEl = mount.querySelector('#researchLibraryList') as HTMLUListElement;
  const emptyEl = mount.querySelector('#researchLibraryEmpty') as HTMLParagraphElement;

  searchInput.value = searchValue;
  sortSelect.value = sortValue;
  archivedCheck.checked = showArchived;

  const handlers = { onOpenDetail, onOpenReport, onDiscuss, onRefine };

  const reload = async (): Promise<void> => {
    searchValue = searchInput.value;
    sortValue = (sortSelect.value as ResearchLibrarySort) || 'newest';
    showArchived = archivedCheck.checked;
    listEl.innerHTML = '<li class="research-library-loading">Loading…</li>';
    try {
      const { items } = await fetchResearchLibrary({
        search: searchValue,
        sort: sortValue,
        archived: showArchived ? undefined : false,
      });
      if (!items.length) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }
      emptyEl.classList.add('hidden');
      listEl.innerHTML = items.map((item) => renderLibraryRow(item)).join('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load library';
      listEl.innerHTML = `<li class="research-library-error">${escapeHtml(msg)}</li>`;
      emptyEl.classList.add('hidden');
    }
  };

  listEl.addEventListener('click', (ev) => {
    handleLibraryListClick(ev, listEl, handlers, reload);
  });

  searchInput.addEventListener('input', () => {
    void reload();
  });
  sortSelect.addEventListener('change', () => {
    void reload();
  });
  archivedCheck.addEventListener('change', () => {
    void reload();
  });

  await reload();
}

function renderLibraryRow(item: ResearchLibraryItem): string {
  const query = escapeHtml(item.query || '(untitled)');
  const cat = item.category ? `<span class="research-library-cat">${escapeHtml(item.category)}</span>` : '';
  const archived = item.archived ? '<span class="research-library-archived-tag">Archived</span>' : '';
  return `
    <li class="research-library-item" data-research-id="${escapeHtml(item.id)}">
      <div class="research-library-item-main">
        <button type="button" class="research-library-open" data-action="open">${query}</button>
        ${cat}
        ${archived}
        <span class="research-library-meta research-mono">${escapeHtml(statusLabel(item.status))} · ${escapeHtml(formatWhen(item.completedAt || item.startedAt))}</span>
      </div>
      <div class="research-library-actions">
        <button type="button" class="research-btn research-btn--ghost" data-action="report">Report</button>
        <button type="button" class="research-btn research-btn--ghost" data-action="discuss">Discuss</button>
        <button type="button" class="research-btn research-btn--ghost" data-action="refine">Refine</button>
        <button type="button" class="research-btn research-btn--ghost" data-action="archive">${item.archived ? 'Unarchive' : 'Archive'}</button>
        <button type="button" class="research-btn research-btn--ghost research-btn--danger" data-action="delete">Delete</button>
      </div>
    </li>
  `;
}

function handleLibraryListClick(
  ev: Event,
  listEl: HTMLElement,
  handlers: Pick<
    ResearchLibraryMountOptions,
    'onOpenDetail' | 'onOpenReport' | 'onDiscuss' | 'onRefine'
  >,
  reload: () => Promise<void>,
): void {
  const target = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!target || !listEl.contains(target)) return;
  const row = target.closest('[data-research-id]') as HTMLElement | null;
  const id = row?.getAttribute('data-research-id');
  if (!id) return;
  const action = target.getAttribute('data-action');
  if (action === 'open') {
    handlers.onOpenDetail(id);
    return;
  }
  if (action === 'report') {
    handlers.onOpenReport(id);
    return;
  }
  if (action === 'discuss') {
    handlers.onDiscuss(id);
    return;
  }
  if (action === 'refine') {
    const query = row?.querySelector('.research-library-open')?.textContent?.trim() ?? '';
    handlers.onRefine(id, query);
    return;
  }
  if (action === 'archive') {
    const archived = Boolean(row?.querySelector('.research-library-archived-tag'));
    void archiveResearch(id, !archived).then(() => {
      void reload();
    });
    return;
  }
  if (action === 'delete') {
    if (!window.confirm('Delete this research run permanently?')) return;
    void deleteResearch(id).then(() => {
      row?.remove();
    });
  }
}

/** Test hook: default sort value. */
export function getLibrarySortForTests(): ResearchLibrarySort {
  return sortValue;
}
