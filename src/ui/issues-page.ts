/**
 * MinnowOS Issues app — list + board, filters, quick capture, detail (MIN-261).
 */

import '../styles/issues.css';

import { createAppIcon } from '../os/icons';
import { isOsAppHash, isOsShellEnabled } from '../os/page-bridge';
import { navigateToDesktop } from '../os/router';
import { canExpandIssueWithAgent } from '../chat/issues/expand-task';
import { subscribeIssuesChanges } from '../state/issues-events';
import {
  addIssue,
  collectIssues,
  countOpenIssues,
  isIssuesStoreLoaded,
  quickCaptureIssue,
  updateIssue,
  type CollectIssuesOptions,
} from '../state/issues-store';
import { getWorkspacePath } from '../state/workspace';
import type { IssueCard, IssuePriority, IssueStatus, IssueType } from '../types';
import {
  closeIssueDetail,
  expandIssueFromUi,
  getSelectedIssueId,
  isIssueExpanding,
  openIssueDetail,
  refreshIssueDetailIfOpen,
} from './issues-detail';

type IssuesViewMode = 'list' | 'board';

type IssuesUiFilters = {
  scope: 'current_workspace' | 'all';
  type: IssueType | 'all';
  status: IssueStatus | 'all';
  priority: IssuePriority | 'all';
  hideDone: boolean;
  search: string;
};

const BOARD_STATUSES: Array<{ id: IssueStatus; label: string }> = [
  { id: 'triage', label: 'Triage' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'planned', label: 'Planned' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'canceled', label: 'Canceled' },
];

/** Columns shown on the board by default (dense Linear-style). */
const PRIMARY_BOARD_STATUSES = BOARD_STATUSES.filter((s) =>
  ['triage', 'todo', 'in_progress', 'planned', 'review', 'done'].includes(s.id),
);

const DEFAULT_FILTERS: IssuesUiFilters = {
  scope: 'current_workspace',
  type: 'all',
  status: 'all',
  priority: 'all',
  hideDone: true,
  search: '',
};

let initialized = false;
let viewMode: IssuesViewMode = 'list';
let filters: IssuesUiFilters = { ...DEFAULT_FILTERS };
let issuesUnsub: (() => void) | null = null;
/** Deep-link issue id from `#/app/issues/ISS-n` (detail panel lands in Phase 2). */
let pendingIssueId: string | undefined;

const ISSUE_DRAG_MIME = 'application/x-minnow-issue-id';

function getRoot(): HTMLElement | null {
  return document.getElementById('issuesView');
}

function getMount(): HTMLElement | null {
  return document.getElementById('issuesPanelMount');
}

function mountHeaderIcon(): void {
  const slot = document.getElementById('issuesPageIcon');
  if (!slot || slot.childElementCount > 0) return;
  slot.appendChild(createAppIcon('issues', { size: 22 }));
}

function collectOptions(): CollectIssuesOptions {
  return {
    scope: filters.scope,
    workspacePath: getWorkspacePath(),
    type: filters.type,
    status: filters.status,
    priority: filters.priority,
    hideDone: filters.hideDone,
    search: filters.search,
  };
}

function formatUpdated(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function renderList(mount: HTMLElement, issues: IssueCard[]): void {
  const list = document.createElement('div');
  list.className = 'issues-list';
  list.setAttribute('role', 'list');

  for (const issue of issues) {
    const row = document.createElement('div');
    row.className = 'issues-row';
    row.setAttribute('role', 'listitem');
    row.dataset.issueId = issue.id;

    const id = document.createElement('span');
    id.className = 'issues-row__id';
    id.textContent = issue.id;

    const type = document.createElement('span');
    type.className = 'issues-row__type';
    type.textContent = issue.type.slice(0, 1).toUpperCase();
    type.title = issue.type;

    const title = document.createElement('span');
    title.className = 'issues-row__title';
    title.textContent = issue.title;

    const priority = document.createElement('span');
    priority.className = `issues-row__priority issues-priority--${issue.priority}`;
    priority.textContent = issue.priority;

    const labels = document.createElement('div');
    labels.className = 'issues-row__labels';
    for (const label of issue.labels.slice(0, 3)) {
      const chip = document.createElement('span');
      chip.className = 'issues-label';
      chip.textContent = label;
      labels.appendChild(chip);
    }
    if (issue.severity) {
      const chip = document.createElement('span');
      chip.className = 'issues-label';
      chip.textContent = issue.severity;
      labels.appendChild(chip);
    }

    const status = document.createElement('span');
    status.className = 'issues-row__status';
    status.textContent = issue.status.replace('_', ' ');

    const updated = document.createElement('span');
    updated.className = 'issues-row__updated';
    updated.textContent = formatUpdated(issue.updatedAt);

    const actions = document.createElement('div');
    actions.className = 'issues-row__actions';
    if (canExpandIssueWithAgent(issue)) {
      const expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'issues-btn issues-row__expand';
      expandBtn.textContent = isIssueExpanding(issue.id) ? 'Expanding…' : 'Expand';
      expandBtn.disabled = isIssueExpanding(issue.id);
      expandBtn.title = 'Expand with agent';
      expandBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        void expandIssueFromUi(issue.id).then(() => renderIssuesPanel());
      });
      actions.appendChild(expandBtn);
    }

    row.append(id, type, title, priority, labels, status, updated, actions);
    row.addEventListener('click', () => navigateToIssueDetail(issue.id));
    row.classList.toggle('is-selected', getSelectedIssueId() === issue.id);
    row.tabIndex = 0;
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigateToIssueDetail(issue.id);
      }
    });
    list.appendChild(row);
  }

  mount.appendChild(list);
}

function bindCardDrag(card: HTMLElement, issueId: string): void {
  card.draggable = true;
  card.addEventListener('dragstart', (event) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.setData(ISSUE_DRAG_MIME, issueId);
    transfer.setData('text/plain', issueId);
    transfer.effectAllowed = 'move';
  });
}

function bindColumnDrop(columnEl: HTMLElement, status: IssueStatus): void {
  columnEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    columnEl.classList.add('is-drag-over');
  });
  columnEl.addEventListener('dragleave', () => {
    columnEl.classList.remove('is-drag-over');
  });
  columnEl.addEventListener('drop', (event) => {
    event.preventDefault();
    columnEl.classList.remove('is-drag-over');
    const transfer = event.dataTransfer;
    const issueId =
      transfer?.getData(ISSUE_DRAG_MIME)?.trim() ||
      transfer?.getData('text/plain')?.trim() ||
      '';
    if (!issueId) return;
    updateIssue(issueId, { status });
    renderIssuesPanel();
  });
}

function renderBoard(mount: HTMLElement, issues: IssueCard[]): void {
  const kanban = document.createElement('div');
  kanban.className = 'issues-kanban';
  kanban.setAttribute('role', 'region');
  kanban.setAttribute('aria-label', 'Issue board');

  const columns = filters.hideDone
    ? PRIMARY_BOARD_STATUSES.filter((c) => c.id !== 'done' && c.id !== 'canceled')
    : PRIMARY_BOARD_STATUSES;

  for (const col of columns) {
    const columnEl = document.createElement('section');
    columnEl.className = 'issues-column';
    columnEl.dataset.status = col.id;

    const head = document.createElement('h3');
    head.className = 'issues-column__head';
    const count = issues.filter((i) => i.status === col.id).length;
    head.textContent = `${col.label} (${count})`;
    columnEl.appendChild(head);

    const list = document.createElement('div');
    list.className = 'issues-column__list';

    for (const issue of issues.filter((i) => i.status === col.id)) {
      const card = document.createElement('article');
      card.className = 'issues-card';
      card.dataset.issueId = issue.id;

      const id = document.createElement('div');
      id.className = 'issues-card__id';
      id.textContent = issue.id;

      const title = document.createElement('h4');
      title.className = 'issues-card__title';
      title.textContent = issue.title;

      const meta = document.createElement('div');
      meta.className = 'issues-card__meta';
      meta.textContent = `${issue.type} · ${issue.priority}`;

      card.append(id, title, meta);
      if (canExpandIssueWithAgent(issue)) {
        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'issues-btn issues-card__expand';
        expandBtn.textContent = isIssueExpanding(issue.id) ? '…' : 'Expand';
        expandBtn.disabled = isIssueExpanding(issue.id);
        expandBtn.title = 'Expand with agent';
        expandBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          void expandIssueFromUi(issue.id).then(() => renderIssuesPanel());
        });
        card.appendChild(expandBtn);
      }
      card.classList.toggle('is-selected', getSelectedIssueId() === issue.id);
      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        navigateToIssueDetail(issue.id);
      });
      bindCardDrag(card, issue.id);
      list.appendChild(card);
    }

    columnEl.appendChild(list);
    bindColumnDrop(columnEl, col.id);
    kanban.appendChild(columnEl);
  }

  mount.appendChild(kanban);
}

/** Rebuild list or board from current filters. */
export function renderIssuesPanel(): void {
  const mount = getMount();
  const summaryEl = document.getElementById('issuesSummary');
  if (!mount || !isIssuesStoreLoaded()) return;

  const issues = collectIssues(collectOptions());
  mount.innerHTML = '';

  const empty = document.createElement('p');
  empty.className = 'issues-empty';
  empty.textContent =
    'No issues match these filters. Use Quick capture or New issue to add one.';
  empty.classList.toggle('hidden', issues.length > 0);
  mount.appendChild(empty);

  if (viewMode === 'list') {
    renderList(mount, issues);
  } else {
    renderBoard(mount, issues);
  }

  if (summaryEl) {
    const openAll = countOpenIssues({ scope: 'all' });
    summaryEl.textContent = `${issues.length} shown · ${openAll} open across all workspaces`;
  }

  // Deep-link / pending selection opens detail; otherwise refresh if already open.
  if (pendingIssueId) {
    const id = pendingIssueId;
    pendingIssueId = undefined;
    openIssueDetail(id);
  } else if (getSelectedIssueId()) {
    refreshIssueDetailIfOpen();
  }

  refreshIssuesSidebarBadge();
}

/** Navigate hash + open detail for an issue. */
function navigateToIssueDetail(issueId: string): void {
  pendingIssueId = issueId;
  openIssueDetail(issueId);
  const next = `#/app/issues/${issueId}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
  // Highlight selection without full remount when possible.
  document.querySelectorAll('.issues-row.is-selected, .issues-card.is-selected').forEach((el) => {
    el.classList.remove('is-selected');
  });
  document
    .querySelector(`.issues-row[data-issue-id="${CSS.escape(issueId)}"], .issues-card[data-issue-id="${CSS.escape(issueId)}"]`)
    ?.classList.add('is-selected');
}

function syncControlsFromState(): void {
  const scope = document.getElementById('issuesScope') as HTMLSelectElement | null;
  const type = document.getElementById('issuesType') as HTMLSelectElement | null;
  const status = document.getElementById('issuesStatus') as HTMLSelectElement | null;
  const priority = document.getElementById('issuesPriority') as HTMLSelectElement | null;
  const hideDone = document.getElementById('issuesHideDone') as HTMLInputElement | null;
  const search = document.getElementById('issuesSearch') as HTMLInputElement | null;
  if (scope) scope.value = filters.scope;
  if (type) type.value = filters.type;
  if (status) status.value = filters.status;
  if (priority) priority.value = filters.priority;
  if (hideDone) hideDone.checked = filters.hideDone;
  if (search) search.value = filters.search;

  document.getElementById('issuesViewList')?.classList.toggle('is-active', viewMode === 'list');
  document.getElementById('issuesViewBoard')?.classList.toggle('is-active', viewMode === 'board');
  document
    .getElementById('issuesViewList')
    ?.setAttribute('aria-pressed', viewMode === 'list' ? 'true' : 'false');
  document
    .getElementById('issuesViewBoard')
    ?.setAttribute('aria-pressed', viewMode === 'board' ? 'true' : 'false');
}

function readFiltersFromControls(): void {
  const scope = document.getElementById('issuesScope') as HTMLSelectElement | null;
  const type = document.getElementById('issuesType') as HTMLSelectElement | null;
  const status = document.getElementById('issuesStatus') as HTMLSelectElement | null;
  const priority = document.getElementById('issuesPriority') as HTMLSelectElement | null;
  const hideDone = document.getElementById('issuesHideDone') as HTMLInputElement | null;
  const search = document.getElementById('issuesSearch') as HTMLInputElement | null;

  filters = {
    scope: scope?.value === 'all' ? 'all' : 'current_workspace',
    type: (type?.value as IssueType | 'all') || 'all',
    status: (status?.value as IssueStatus | 'all') || 'all',
    priority: (priority?.value as IssuePriority | 'all') || 'all',
    hideDone: hideDone?.checked ?? true,
    search: search?.value ?? '',
  };
}

function onFiltersChanged(): void {
  readFiltersFromControls();
  renderIssuesPanel();
}

function ensureSubscriptions(): void {
  if (issuesUnsub) return;
  issuesUnsub = subscribeIssuesChanges(() => {
    if (isIssuesPageOpen()) renderIssuesPanel();
    else refreshIssuesSidebarBadge();
  });
}

function setNewFormOpen(open: boolean): void {
  const form = document.getElementById('issuesNewForm');
  form?.classList.toggle('is-open', open);
  if (open) {
    (document.getElementById('issuesNewTitle') as HTMLInputElement | null)?.focus();
  }
}

function submitNewIssue(event: Event): void {
  event.preventDefault();
  const titleEl = document.getElementById('issuesNewTitle') as HTMLInputElement | null;
  const descEl = document.getElementById('issuesNewDescription') as HTMLTextAreaElement | null;
  const typeEl = document.getElementById('issuesNewType') as HTMLSelectElement | null;
  const priorityEl = document.getElementById('issuesNewPriority') as HTMLSelectElement | null;
  const title = titleEl?.value.trim() ?? '';
  if (!title) return;
  addIssue({
    title,
    description: descEl?.value.trim() ?? '',
    type: (typeEl?.value as IssueType) || 'task',
    priority: (priorityEl?.value as IssuePriority) || 'none',
    status: 'triage',
    workspacePath: getWorkspacePath(),
  });
  if (titleEl) titleEl.value = '';
  if (descEl) descEl.value = '';
  setNewFormOpen(false);
  renderIssuesPanel();
}

function onQuickCaptureKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const input = event.currentTarget as HTMLInputElement;
  const title = input.value.trim();
  if (!title) return;
  quickCaptureIssue(title, getWorkspacePath());
  input.value = '';
  renderIssuesPanel();
}

let staticBindingsDone = false;

function bindStaticControls(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  document.getElementById('issuesScope')?.addEventListener('change', onFiltersChanged);
  document.getElementById('issuesType')?.addEventListener('change', onFiltersChanged);
  document.getElementById('issuesStatus')?.addEventListener('change', onFiltersChanged);
  document.getElementById('issuesPriority')?.addEventListener('change', onFiltersChanged);
  document.getElementById('issuesHideDone')?.addEventListener('change', onFiltersChanged);
  document.getElementById('issuesSearch')?.addEventListener('input', onFiltersChanged);

  document.getElementById('issuesViewList')?.addEventListener('click', () => {
    viewMode = 'list';
    syncControlsFromState();
    renderIssuesPanel();
  });
  document.getElementById('issuesViewBoard')?.addEventListener('click', () => {
    viewMode = 'board';
    syncControlsFromState();
    renderIssuesPanel();
  });

  document.getElementById('btnIssuesNew')?.addEventListener('click', () => {
    setNewFormOpen(true);
  });
  document.getElementById('btnIssuesNewCancel')?.addEventListener('click', () => {
    setNewFormOpen(false);
  });
  document.getElementById('issuesNewForm')?.addEventListener('submit', submitNewIssue);

  document
    .getElementById('issuesQuickCapture')
    ?.addEventListener('keydown', onQuickCaptureKeydown as EventListener);

  // Sidebar: Issues replaces All bugs.
  document.getElementById('btnAllBugs')?.addEventListener('click', () => {
    openIssuesFromSidebar();
  });
}

/** Open Issues from the chat sidebar footer button. */
export function openIssuesFromSidebar(): void {
  if (isOsShellEnabled()) {
    void import('../os/router').then((m) => m.launchApp('issues'));
    return;
  }
  void openIssues();
}

/** Wire listeners; safe to call on every boot for sidebar badge. */
export function initIssuesPage(): void {
  if (initialized) return;
  initialized = true;
  mountHeaderIcon();
  bindStaticControls();
  ensureSubscriptions();
  refreshIssuesSidebarBadge();
  window.addEventListener('hashchange', onHashChange);
  const hash = window.location.hash;
  if (hash === '#/app/issues' || hash.startsWith('#/app/issues/')) {
    void openIssues();
  }
}

export async function openIssues(options?: { issueId?: string }): Promise<void> {
  const root = getRoot();
  if (!root) return;

  pendingIssueId = options?.issueId;
  root.classList.add('is-open');
  mountHeaderIcon();
  ensureSubscriptions();
  // Ensure store exists before first paint (router/deep-link may open before boot load finishes).
  if (!isIssuesStoreLoaded()) {
    const { loadIssuesFromStorage } = await import('../state/issues-store');
    await loadIssuesFromStorage();
  }
  syncControlsFromState();
  try {
    renderIssuesPanel();
  } catch {
    /* ignore render failures outside a fully booted shell */
  }

  if (!isOsShellEnabled()) {
    const next = options?.issueId ? `#/app/issues/${options.issueId}` : '#/app/issues';
    if (window.location.hash !== next) window.location.hash = next;
  }
}

export function closeIssues(options?: { skipNavigate?: boolean }): void {
  const root = getRoot();
  if (!root) return;
  root.classList.remove('is-open');
  pendingIssueId = undefined;
  closeIssueDetail();
  setNewFormOpen(false);
  if (!isOsShellEnabled()) {
    if (!options?.skipNavigate && window.location.hash.startsWith('#/app/issues')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    navigateToDesktop();
  }
}

export function isIssuesPageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

/** Consume deep-link issue id prepared by the router (Phase 2 opens detail). */
export function consumePendingIssueId(): string | undefined {
  const id = pendingIssueId;
  pendingIssueId = undefined;
  return id;
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash === '#/app/issues' || hash.startsWith('#/app/issues/')) {
    const match = hash.match(/^#\/app\/issues\/([\w-]+)/);
    void openIssues({ issueId: match?.[1] });
    return;
  }
  if (isOsShellEnabled() && isOsAppHash(hash)) return;
  if (isIssuesPageOpen()) {
    closeIssues({ skipNavigate: true });
  }
}

/** Refresh sidebar badge = open statuses for current workspace. */
export function refreshIssuesSidebarBadge(): void {
  if (typeof document === 'undefined' || !isIssuesStoreLoaded()) return;
  const badge = document.getElementById('btnAllBugsCount');
  if (!badge) return;
  const openCurrent = countOpenIssues({
    scope: 'current_workspace',
    workspacePath: getWorkspacePath(),
  });
  badge.textContent = openCurrent > 0 ? String(openCurrent) : '';
  badge.hidden = openCurrent === 0;
  badge.setAttribute('aria-hidden', openCurrent === 0 ? 'true' : 'false');
}
