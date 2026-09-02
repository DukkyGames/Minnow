/**
 * Research rail — every run, grouped by recency, as rows rather than cards.
 *
 * Rows carry their own state word (running / failed / stopped) so the reader
 * can tell what happened without opening anything. A run that is still in
 * flight lives only in the server's memory until it finishes, so the caller
 * passes it in as `liveRuns` and it is merged ahead of the persisted list.
 * Right-click a row (or use the ⋯ control) for archive, delete, and related actions.
 */

import { appConfirm } from '../ui/app-dialog';
import { archiveResearch, deleteResearch, fetchResearchLibrary } from './client';
import { formatRunDuration } from './run-summary';
import { iconHtml } from '../ui/icon';
import type { ResearchLibraryItem } from './types';

// ── Titles ───────────────────────────────────────────────────────────────────

/** Prefer persisted report title over the original research query. */
export function researchDisplayTitle(
  item: Pick<ResearchLibraryItem, 'title' | 'query'>,
): string {
  const title = item.title?.trim();
  if (title) return title;
  const query = item.query?.trim();
  return query || 'Untitled run';
}

export interface ResearchRailHandlers {
  onSelect: (id: string) => void;
  onOpenReport: (id: string) => void;
  onDiscuss: (id: string) => void;
  onRefine: (id: string, query: string) => void;
  /** Archive / delete changed the list — refetch. */
  onChanged: () => void;
}

export interface ResearchRailOptions extends ResearchRailHandlers {
  mount: HTMLElement;
  search?: string;
  archived?: boolean;
  activeId?: string | null;
  liveRuns?: ResearchLibraryItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function itemTime(item: ResearchLibraryItem): number {
  const raw = item.completedAt || item.startedAt;
  if (!raw) {
    return 0;
  }
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Recency bucket label for a run. Running work always sorts first. */
export function researchRunGroup(item: ResearchLibraryItem, now = Date.now()): string {
  if (item.status === 'running') {
    return 'Running';
  }
  const t = itemTime(item);
  if (!t) {
    return 'Undated';
  }
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (t >= startOfToday) {
    return 'Today';
  }
  if (t >= startOfToday - DAY_MS) {
    return 'Yesterday';
  }
  if (t >= startOfToday - 7 * DAY_MS) {
    return 'This week';
  }
  if (t >= startOfToday - 30 * DAY_MS) {
    return 'This month';
  }
  return 'Earlier';
}

const GROUP_ORDER = [
  'Running',
  'Today',
  'Yesterday',
  'This week',
  'This month',
  'Earlier',
  'Undated',
];

// ── Merge ────────────────────────────────────────────────────────────────────

/** Merge in-flight runs ahead of the persisted list, newest first, no duplicates. */
export function mergeResearchRuns(
  persisted: ResearchLibraryItem[],
  live: ResearchLibraryItem[] = [],
): ResearchLibraryItem[] {
  const seen = new Set<string>();
  const out: ResearchLibraryItem[] = [];
  for (const item of [...live, ...persisted]) {
    if (!item.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    out.push(item);
  }
  return out.sort((a, b) => {
    const aRunning = a.status === 'running' ? 1 : 0;
    const bRunning = b.status === 'running' ? 1 : 0;
    if (aRunning !== bRunning) {
      return bRunning - aRunning;
    }
    return itemTime(b) - itemTime(a);
  });
}

/** Compact run summary: `31 sources · 4 rounds · 6:12`. */
export function researchRunMeta(item: ResearchLibraryItem): string {
  const parts: string[] = [];
  if (item.sourceCount) {
    parts.push(`${item.sourceCount} source${item.sourceCount === 1 ? '' : 's'}`);
  }
  const rounds = item.rounds != null && item.rounds !== '' ? Number(item.rounds) : NaN;
  if (Number.isFinite(rounds) && rounds > 0) {
    parts.push(`${rounds} round${rounds === 1 ? '' : 's'}`);
  }
  const duration = formatRunDuration(item.duration ?? '');
  if (duration) {
    parts.push(duration);
  }
  if (!parts.length) {
    const t = itemTime(item);
    if (t) {
      return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  }
  return parts.join(' · ');
}

function stateWord(status: ResearchLibraryItem['status']): string {
  if (status === 'running') return 'running';
  if (status === 'error') return 'failed';
  if (status === 'cancelled') return 'stopped';
  return '';
}

function closeRowMenu(): void {
  document.querySelector('.rs-menu')?.remove();
  document
    .querySelectorAll('.rs-row.is-menu-open')
    .forEach((el) => el.classList.remove('is-menu-open'));
}

type RowMenuPosition =
  | { kind: 'anchor'; anchor: HTMLElement }
  | { kind: 'pointer'; clientX: number; clientY: number };

function positionRowMenu(menu: HTMLElement, position: RowMenuPosition): void {
  const height = menu.offsetHeight || 200;
  const width = menu.offsetWidth || 180;
  let top: number;
  let left: number;
  if (position.kind === 'pointer') {
    top =
      position.clientY + height > window.innerHeight
        ? position.clientY - height - 4
        : position.clientY + 4;
    left =
      position.clientX + width > window.innerWidth
        ? position.clientX - width
        : position.clientX;
  } else {
    const rect = position.anchor.getBoundingClientRect();
    top = rect.bottom + height > window.innerHeight ? rect.top - height - 4 : rect.bottom + 4;
    left = rect.right - width;
  }
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, left)}px`;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function buildRow(
  item: ResearchLibraryItem,
  activeId: string | null | undefined,
  handlers: ResearchRailHandlers,
): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'rs-row';
  row.dataset.researchId = item.id;
  row.setAttribute('role', 'option');
  const isActive = item.id === activeId;
  row.setAttribute('aria-selected', isActive ? 'true' : 'false');
  if (isActive) {
    row.classList.add('is-active');
  }

  const title = document.createElement('span');
  title.className = 'rs-row__title';
  title.textContent = researchDisplayTitle(item);

  const meta = document.createElement('span');
  meta.className = 'rs-row__meta';

  const word = stateWord(item.status);
  if (word) {
    const state = document.createElement('span');
    state.className = `rs-row__state is-${item.status === 'error' ? 'error' : item.status}`;
    state.textContent = word;
    meta.appendChild(state);
  }
  meta.appendChild(document.createTextNode(researchRunMeta(item)));

  row.append(title, meta);
  row.addEventListener('click', () => handlers.onSelect(item.id));
  row.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    closeRowMenu();
    openRowMenu({ kind: 'pointer', clientX: ev.clientX, clientY: ev.clientY }, row, item, handlers);
  });

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'rs-row__menu';
  menuBtn.setAttribute('aria-label', `Actions for ${researchDisplayTitle(item)}`);
  menuBtn.innerHTML = iconHtml('more', { size: 14 });
  menuBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const alreadyOpen = row.classList.contains('is-menu-open');
    closeRowMenu();
    if (!alreadyOpen) {
      openRowMenu({ kind: 'anchor', anchor: menuBtn }, row, item, handlers);
    }
  });

  const wrap = document.createElement('div');
  wrap.className = 'rs-row-wrap';
  wrap.append(row, menuBtn);
  return wrap;
}

function openRowMenu(
  position: RowMenuPosition,
  row: HTMLElement,
  item: ResearchLibraryItem,
  handlers: ResearchRailHandlers,
): void {
  row.classList.add('is-menu-open');

  const menu = document.createElement('div');
  menu.className = 'rs-menu';
  menu.setAttribute('role', 'menu');

  const add = (label: string, run: () => void, danger = false): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    if (danger) {
      btn.classList.add('is-danger');
    }
    btn.addEventListener('click', () => {
      closeRowMenu();
      run();
    });
    menu.appendChild(btn);
  };

  if (item.status !== 'running') {
    add('Open report', () => handlers.onOpenReport(item.id));
    add('Discuss in chat', () => handlers.onDiscuss(item.id));
    add('Refine', () => handlers.onRefine(item.id, item.query));
    const sep = document.createElement('div');
    sep.className = 'rs-menu__sep';
    menu.appendChild(sep);
  }
  add(item.archived ? 'Unarchive' : 'Archive', () => {
    void archiveResearch(item.id, !item.archived).then(() => handlers.onChanged());
  });
  add(
    'Delete',
    () => {
      void (async () => {
        const ok = await appConfirm(
          `Delete this run permanently?\n\n${researchDisplayTitle(item)}`,
        );
        if (!ok) {
          return;
        }
        await deleteResearch(item.id);
        handlers.onChanged();
      })();
    },
    true,
  );

  document.body.appendChild(menu);
  positionRowMenu(menu, position);
}

let dismissBound = false;

function bindMenuDismiss(): void {
  if (dismissBound) {
    return;
  }
  dismissBound = true;
  document.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('.rs-menu') || target?.closest('.rs-row__menu')) {
      return;
    }
    closeRowMenu();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeRowMenu();
    }
  });
}

// ── Render ───────────────────────────────────────────────────────────────────

/** Fetch and paint the rail. Returns the merged runs for caller-side lookup. */
export async function renderResearchRail(
  options: ResearchRailOptions,
): Promise<ResearchLibraryItem[]> {
  const { mount, search, archived, activeId, liveRuns = [] } = options;
  bindMenuDismiss();
  closeRowMenu();

  const handlers: ResearchRailHandlers = {
    onSelect: options.onSelect,
    onOpenReport: options.onOpenReport,
    onDiscuss: options.onDiscuss,
    onRefine: options.onRefine,
    onChanged: options.onChanged,
  };

  let persisted: ResearchLibraryItem[] = [];
  let loadError = '';
  try {
    const { items } = await fetchResearchLibrary({
      search,
      sort: 'recent',
      archived: archived === true,
      limit: 200,
    });
    persisted = items;
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Could not load saved runs';
  }

  const term = search?.trim().toLowerCase() ?? '';
  const live = archived
    ? []
    : liveRuns.filter(
        (item) =>
          !term ||
          item.query.toLowerCase().includes(term) ||
          (item.title?.toLowerCase().includes(term) ?? false),
      );
  const runs = mergeResearchRuns(persisted, live);

  mount.replaceChildren();

  if (loadError) {
    const p = document.createElement('p');
    p.className = 'rs-rail__empty';
    p.textContent = loadError;
    mount.appendChild(p);
    return runs;
  }

  if (!runs.length) {
    const p = document.createElement('p');
    p.className = 'rs-rail__empty';
    p.textContent = term
      ? 'Nothing matches that filter.'
      : archived
        ? 'No archived runs.'
        : 'No research yet. Ask a question and Minnow will go read, then write you a brief.';
    mount.appendChild(p);
    return runs;
  }

  const now = Date.now();
  const grouped = new Map<string, ResearchLibraryItem[]>();
  for (const item of runs) {
    const group = researchRunGroup(item, now);
    const bucket = grouped.get(group);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(group, [item]);
    }
  }

  for (const group of GROUP_ORDER) {
    const items = grouped.get(group);
    if (!items?.length) {
      continue;
    }
    const label = document.createElement('div');
    label.className = 'rs-group__label';
    label.textContent = group;
    mount.appendChild(label);
    for (const item of items) {
      mount.appendChild(buildRow(item, activeId, handlers));
    }
  }

  return runs;
}

/** Move the selection highlight without refetching the list. */
export function setActiveResearchRow(mount: HTMLElement, id: string | null): void {
  for (const row of mount.querySelectorAll<HTMLElement>('.rs-row')) {
    const on = Boolean(id) && row.dataset.researchId === id;
    row.classList.toggle('is-active', on);
    row.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}
