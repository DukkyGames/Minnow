/**
 * Deep Research library — card grid with compact toolbar and overflow menus.
 */

import {
  archiveResearch,
  deleteResearch,
  fetchResearchLibrary,
} from './client';
import { researchCategoryLabel } from './categories';
import type { ResearchLibraryItem, ResearchLibrarySort } from './types';

export interface ResearchLibraryMountOptions {
  mount: HTMLElement;
  onOpenDetail: (id: string) => void;
  onOpenReport: (id: string) => void;
  onDiscuss: (id: string) => void;
  onRefine: (id: string, query: string) => void;
  onNewResearch?: () => void;
}

let searchValue = '';
let sortValue: ResearchLibrarySort = 'newest';
let showArchived = false;
let openMenuId: string | null = null;
let lastLibraryItems: ResearchLibraryItem[] = [];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWhen(iso?: string): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function closeOpenMenu(): void {
  openMenuId = null;
  document.querySelectorAll('.dr-lib-menu').forEach((el) => el.remove());
}

function renderLibraryCard(item: ResearchLibraryItem): string {
  const title = escapeHtml(item.query || '(untitled)');
  const tag = escapeHtml(researchCategoryLabel(item.category));
  const rounds = item.rounds != null && item.rounds !== '' ? String(item.rounds) : '—';
  const sources = item.sourceCount != null ? String(item.sourceCount) : '—';
  const dur = item.duration?.trim() || '—';
  const when = formatWhen(item.completedAt || item.startedAt);
  return `
    <div class="dr-lib-card" data-research-id="${escapeHtml(item.id)}">
      <button type="button" class="dr-lib-menu-btn" data-action="menu" data-research-id="${escapeHtml(item.id)}" aria-label="More actions">⋯</button>
      <button type="button" class="dr-lib-card-body" data-action="open" data-research-id="${escapeHtml(item.id)}">
        <div class="dr-lib-tag research-mono">${tag}</div>
        <div class="dr-lib-title">${title}</div>
        <div class="dr-lib-meta research-mono">${escapeHtml(rounds)} rounds · ${escapeHtml(sources)} sources · ${escapeHtml(dur)}</div>
        <div class="dr-lib-when research-mono"><span aria-hidden="true">🕐</span> ${escapeHtml(when)}</div>
      </button>
    </div>
  `;
}

function showCardMenu(
  card: HTMLElement,
  item: ResearchLibraryItem,
  handlers: Pick<
    ResearchLibraryMountOptions,
    'onOpenDetail' | 'onOpenReport' | 'onDiscuss' | 'onRefine'
  >,
  reload: () => Promise<void>,
): void {
  closeOpenMenu();
  openMenuId = item.id;
  const menu = document.createElement('div');
  menu.className = 'dr-lib-menu';
  menu.innerHTML = `
    <button type="button" data-action="open">Open</button>
    <button type="button" data-action="report">Report</button>
    <button type="button" data-action="discuss">Discuss</button>
    <button type="button" data-action="refine">Refine</button>
    <button type="button" data-action="archive">${item.archived ? 'Unarchive' : 'Archive'}</button>
    <button type="button" data-action="delete" class="danger">Delete</button>
  `;
  card.appendChild(menu);
  menu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const target = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    const action = target?.getAttribute('data-action');
    if (!action) {
      return;
    }
    closeOpenMenu();
    if (action === 'open') {
      handlers.onOpenDetail(item.id);
      return;
    }
    if (action === 'report') {
      handlers.onOpenReport(item.id);
      return;
    }
    if (action === 'discuss') {
      handlers.onDiscuss(item.id);
      return;
    }
    if (action === 'refine') {
      handlers.onRefine(item.id, item.query);
      return;
    }
    if (action === 'archive') {
      void archiveResearch(item.id, !item.archived).then(() => reload());
      return;
    }
    if (action === 'delete') {
      if (!window.confirm('Delete this research run permanently?')) {
        return;
      }
      void deleteResearch(item.id).then(() => reload());
    }
  });
}

/** Render library toolbar + card grid into the mount element. */
export async function renderResearchLibrary(options: ResearchLibraryMountOptions): Promise<void> {
  const { mount, onOpenDetail, onOpenReport, onDiscuss, onRefine, onNewResearch } = options;
  mount.innerHTML = `
    <div class="dr-lib-toolbar">
      <label class="dr-lib-field dr-lib-field-search" for="researchLibrarySearch">
        <span class="dr-flabel research-mono">SEARCH</span>
        <input
          type="search"
          id="researchLibrarySearch"
          class="dr-input research-input"
          placeholder="Filter saved reports…"
          aria-label="Search library"
        />
      </label>
      <label class="dr-lib-field dr-lib-field-sort" for="researchLibrarySort">
        <span class="dr-flabel research-mono">SORT</span>
        <div class="dr-select">
          <select id="researchLibrarySort" class="research-select" aria-label="Sort library">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="query">A–Z</option>
          </select>
        </div>
      </label>
      <div class="dr-lib-field dr-lib-field-archived">
        <span class="dr-flabel research-mono" id="researchLibraryArchivedLabel">ARCHIVED</span>
        <label class="dr-switch" for="researchLibraryArchived">
          <input
            type="checkbox"
            id="researchLibraryArchived"
            class="dr-switch__input"
            role="switch"
            aria-labelledby="researchLibraryArchivedLabel"
          />
          <span class="dr-switch__track" aria-hidden="true">
            <span class="dr-switch__thumb"></span>
          </span>
        </label>
      </div>
    </div>
    <div class="dr-lib-head">
      <div class="dr-lib-count research-mono" id="researchLibraryCount">0 saved reports</div>
      <button type="button" class="dr-run sm" id="btnResearchLibraryNew">+ New research</button>
    </div>
    <div id="researchLibraryGrid" class="dr-lib-grid"></div>
    <p id="researchLibraryEmpty" class="research-library-empty hidden">No research runs yet.</p>
  `;

  const searchInput = mount.querySelector('#researchLibrarySearch') as HTMLInputElement;
  const sortSelect = mount.querySelector('#researchLibrarySort') as HTMLSelectElement;
  const archivedCheck = mount.querySelector('#researchLibraryArchived') as HTMLInputElement;
  const gridEl = mount.querySelector('#researchLibraryGrid') as HTMLElement;
  const emptyEl = mount.querySelector('#researchLibraryEmpty') as HTMLParagraphElement;
  const countEl = mount.querySelector('#researchLibraryCount') as HTMLElement;

  searchInput.value = searchValue;
  sortSelect.value = sortValue;
  archivedCheck.checked = showArchived;

  const handlers = { onOpenDetail, onOpenReport, onDiscuss, onRefine };

  const reload = async (): Promise<void> => {
    searchValue = searchInput.value;
    sortValue = (sortSelect.value as ResearchLibrarySort) || 'newest';
    showArchived = archivedCheck.checked;
    gridEl.innerHTML = '<p class="research-mono" style="padding:12px">Loading…</p>';
    try {
      const sortParam =
        sortValue === 'newest' ? 'recent' : sortValue === 'oldest' ? 'oldest' : 'alpha';
      const { items } = await fetchResearchLibrary({
        search: searchValue,
        sort: sortParam,
        archived: showArchived,
      });
      lastLibraryItems = items;
      countEl.textContent = `${items.length} saved report${items.length === 1 ? '' : 's'}`;
      if (!items.length) {
        gridEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }
      emptyEl.classList.add('hidden');
      gridEl.innerHTML = items.map((item) => renderLibraryCard(item)).join('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load library';
      gridEl.innerHTML = `<p class="research-library-empty">${escapeHtml(msg)}</p>`;
      emptyEl.classList.add('hidden');
    }
  };

  gridEl.addEventListener('click', (ev) => {
    const menuBtn = (ev.target as HTMLElement).closest('[data-action="menu"]') as HTMLElement | null;
    if (menuBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = menuBtn.getAttribute('data-research-id');
      const card = menuBtn.closest('.dr-lib-card') as HTMLElement | null;
      if (!id || !card) {
        return;
      }
      if (openMenuId === id) {
        closeOpenMenu();
        return;
      }
      const item =
        lastLibraryItems.find((row) => row.id === id) ?? {
          id,
          query: card.querySelector('.dr-lib-title')?.textContent?.trim() ?? '',
          status: 'done' as const,
          archived: showArchived,
        };
      showCardMenu(card, item, handlers, reload);
      return;
    }
    const openBtn = (ev.target as HTMLElement).closest('[data-action="open"]') as HTMLElement | null;
    if (!openBtn || !gridEl.contains(openBtn)) {
      return;
    }
    const id =
      openBtn.getAttribute('data-research-id') ??
      openBtn.closest('[data-research-id]')?.getAttribute('data-research-id');
    if (id) {
      closeOpenMenu();
      onOpenDetail(id);
    }
  });

  document.addEventListener('click', (ev) => {
    if (!(ev.target as HTMLElement).closest('.dr-lib-card')) {
      closeOpenMenu();
    }
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
  mount.querySelector('#btnResearchLibraryNew')?.addEventListener('click', () => {
    onNewResearch?.();
  });

  await reload();
}

/** Test hook: default sort value. */
export function getLibrarySortForTests(): ResearchLibrarySort {
  return sortValue;
}
