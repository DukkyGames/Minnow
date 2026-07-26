/**
 * MinnowOS Issues app — list + board, filters, quick capture, detail (MIN-261).
 * Code sidebar opens an embed in #chatArea; desktop/dock keeps the fullscreen app.
 */

import '../styles/issues.css';

import { notifyAskQuestionDisplayContextChanged } from '../chat/ask-question-display';
import { canExpandIssueWithAgent } from '../chat/issues/expand-task';
import { createAppIcon } from '../os/icons';
import { getForegroundAppId, getOsView } from '../os/instances';
import { isOsAppHash, isOsShellEnabled } from '../os/page-bridge';
import { navigateToDesktop } from '../os/router';
import { subscribeIssuesChanges } from '../state/issues-events';
import {
  addIssue,
  collectIssues,
  countOpenIssues,
  deleteIssues,
  isIssuesStoreLoaded,
  quickCaptureIssue,
  updateIssue,
  type CollectIssuesOptions,
} from '../state/issues-store';
import { sessionState } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import type { IssueCard, IssuePriority, IssueStatus, IssueType } from '../types';
import { appConfirm } from './app-dialog';
import {
  closeIssueDetail,
  expandIssueFromUi,
  getSelectedIssueId,
  isIssueExpanding,
  openIssueDetail,
  refreshIssueDetailIfOpen,
} from './issues-detail';
import {
  ariaSortValue,
  cycleIssuesListSort,
  DEFAULT_ISSUES_LIST_SORT,
  sortIssuesForList,
  type IssuesListSort,
  type IssuesSortKey,
} from './issues-list-sort';
import { stripMainColumnOverlayClasses } from './main-column-overlay';

const CHAT_AREA_ISSUES_CLASS = 'chat-area--issues';
const MAIN_COLUMN_ISSUES_CLASS = 'main-column--issues';
const ISSUES_EMBEDDED_CLASS = 'issues-page--embedded';
const EMBED_BACK_BTN_ID = 'btnIssuesEmbedBack';

type IssuesViewMode = 'list' | 'board';

const ISSUES_SORT_KEYS = new Set<IssuesSortKey>([
  'id',
  'type',
  'title',
  'status',
  'priority',
  'labels',
  'updated',
]);

/** Human labels for sort aria-label (avoid reading indicator glyphs from the button). */
const ISSUES_SORT_LABELS: Record<IssuesSortKey, string> = {
  id: 'ID',
  type: 'Type',
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  labels: 'Labels',
  updated: 'Updated',
};

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
/** Active list-column sort (session-only; board view ignores this). */
let listSort: IssuesListSort = { ...DEFAULT_ISSUES_LIST_SORT };
let issuesUnsub: (() => void) | null = null;
/** Deep-link issue id from `#/app/issues/ISS-n` (detail panel lands in Phase 2). */
let pendingIssueId: string | undefined;
/** Multiselect: checked issue ids for bulk actions. */
const selectedIssueIds = new Set<string>();
/** Anchor issue id for Shift-range selection. */
let lastSelectionAnchorId: string | undefined;

const ISSUE_DRAG_MIME = 'application/x-minnow-issue-id';

/** Where #issuesView lived before it was moved into the Code #chatArea embed. */
let issuesViewHome: { parent: HTMLElement; nextSibling: ChildNode | null } | null = null;
/** Chat to restore when closing the Code embed. */
let returnChatId: string | null = null;
let embedEscapeBound = false;

function getRoot(): HTMLElement | null {
  return document.getElementById('issuesView');
}

/** True when Issues is hosted inside the Code app main column. */
export function isIssuesEmbeddedInCode(): boolean {
  const area = document.getElementById('chatArea');
  const root = getRoot();
  if (!area || !root) return false;
  return area.contains(root) && area.classList.contains(CHAT_AREA_ISSUES_CLASS);
}

/** Sidebar / Code entry should embed instead of launching the fullscreen Issues app. */
export function shouldEmbedIssuesFromCodeSidebar(): boolean {
  return isOsShellEnabled() && getOsView() === 'app' && getForegroundAppId() === 'code';
}

function getDefaultIssuesHome(): { parent: HTMLElement; nextSibling: ChildNode | null } | null {
  const parent = document.getElementById('osAppsLayer');
  if (!parent) return null;
  return { parent, nextSibling: null };
}

/** Remember the apps-layer slot so fullscreen Issues can reclaim the view. */
function rememberIssuesHome(root: HTMLElement): void {
  const area = document.getElementById('chatArea');
  if (area?.contains(root)) return;
  const parent = root.parentElement;
  if (!parent) return;
  issuesViewHome = { parent, nextSibling: root.nextSibling };
}

function removeEmbeddedBackButton(): void {
  document.getElementById(EMBED_BACK_BTN_ID)?.remove();
}

/** Inject a Back control into the Issues header while embedded in Code. */
function ensureEmbeddedBackButton(): void {
  if (document.getElementById(EMBED_BACK_BTN_ID)) return;
  const brand = document.querySelector('#issuesView .issues-header__brand');
  if (!brand) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = EMBED_BACK_BTN_ID;
  btn.className = 'icon-btn issues-embed-back';
  btn.setAttribute('aria-label', 'Back to chat');
  btn.title = 'Back to chat';
  btn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
  btn.addEventListener('click', () => {
    closeIssuesEmbeddedInCode();
  });
  brand.insertBefore(btn, brand.firstChild);
}

function syncIssuesSidebarButton(): void {
  const btn = document.getElementById('btnAllBugs');
  if (!btn) return;
  const open = isIssuesEmbeddedInCode();
  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) btn.setAttribute('aria-current', 'page');
  else btn.removeAttribute('aria-current');
}

function onEmbedEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isIssuesEmbeddedInCode()) return;
  // Detail slide-over owns Escape first when open.
  if (document.getElementById('issuesDetailHost')) return;
  event.preventDefault();
  closeIssuesEmbeddedInCode();
}

function bindEmbedEscape(): void {
  if (embedEscapeBound) return;
  embedEscapeBound = true;
  window.addEventListener('keydown', onEmbedEscape);
}

function unbindEmbedEscape(): void {
  if (!embedEscapeBound) return;
  embedEscapeBound = false;
  window.removeEventListener('keydown', onEmbedEscape);
}

/** Move #issuesView back to the OS apps layer (or its remembered home). */
export function restoreIssuesViewIfMounted(): void {
  const root = getRoot();
  if (!root) {
    issuesViewHome = null;
    return;
  }

  const appsLayer = document.getElementById('osAppsLayer');
  if (appsLayer?.contains(root) && !document.getElementById('chatArea')?.contains(root)) {
    root.classList.remove(ISSUES_EMBEDDED_CLASS);
    removeEmbeddedBackButton();
    issuesViewHome = null;
    return;
  }

  const home = issuesViewHome ?? getDefaultIssuesHome();
  if (!home) return;

  const { parent, nextSibling } = home;
  if (nextSibling && nextSibling.parentNode === parent) {
    parent.insertBefore(root, nextSibling);
  } else {
    parent.appendChild(root);
  }
  root.classList.remove(ISSUES_EMBEDDED_CLASS);
  removeEmbeddedBackButton();
  issuesViewHome = null;
}

/**
 * Restore Issues out of #chatArea before the transcript repaints.
 * @returns true when an active Issues embed was torn down.
 */
export function teardownIssuesEmbedBeforeChatPaint(): boolean {
  const area = document.getElementById('chatArea');
  const root = getRoot();
  const inChat = Boolean(area && root && area.contains(root));
  const hadEmbed = isIssuesEmbeddedInCode() || inChat || Boolean(issuesViewHome);

  if (inChat) {
    restoreIssuesViewIfMounted();
  } else {
    // app-host may have already reparented the view — clear leftover bookkeeping.
    issuesViewHome = null;
    root?.classList.remove(ISSUES_EMBEDDED_CLASS);
    removeEmbeddedBackButton();
  }

  stripMainColumnOverlayClasses();
  returnChatId = null;
  unbindEmbedEscape();
  syncIssuesSidebarButton();
  return hadEmbed;
}

async function closeCompetingMainColumnViews(): Promise<void> {
  const orchestrate = await import('./orchestrate-hub');
  if (orchestrate.isOrchestrateHubMounted()) orchestrate.closeOrchestrateHub();
  const overview = await import('./code-overview');
  if (overview.isCodeOverviewOpen()) {
    overview.closeCodeOverview({ skipNavigate: true, restoreChat: false });
  }
  const { teardownCodeBrainMapBeforeChatPaint } = await import('./code-brain-map');
  teardownCodeBrainMapBeforeChatPaint();
  const { teardownHub } = await import('./hub');
  teardownHub();
}

/** Mount Issues inside the Code app #chatArea (does not change the OS foreground app). */
export async function openIssuesEmbeddedInCode(options?: { issueId?: string }): Promise<void> {
  const root = getRoot();
  const area = document.getElementById('chatArea');
  if (!root || !area) return;

  if (isIssuesEmbeddedInCode()) {
    await openIssues({ issueId: options?.issueId, embedded: true });
    return;
  }

  await closeCompetingMainColumnViews();

  // Always capture the chat under the embed (app-host may have cleared DOM without us).
  returnChatId = sessionState?.activeId ?? null;

  rememberIssuesHome(root);
  area.replaceChildren();
  area.appendChild(root);
  stripMainColumnOverlayClasses();
  area.classList.add(CHAT_AREA_ISSUES_CLASS);
  document.getElementById('mainColumn')?.classList.add(MAIN_COLUMN_ISSUES_CLASS);
  root.classList.add(ISSUES_EMBEDDED_CLASS);

  ensureEmbeddedBackButton();
  bindEmbedEscape();
  await openIssues({ issueId: options?.issueId, embedded: true });
  syncIssuesSidebarButton();
  notifyAskQuestionDisplayContextChanged();
}

/** Tear down the Code embed and optionally restore the prior chat. */
export function closeIssuesEmbeddedInCode(options?: { restoreChat?: boolean }): void {
  if (!isIssuesEmbeddedInCode() && !issuesViewHome) return;

  const savedReturnChatId = returnChatId;
  const root = getRoot();
  root?.classList.remove('is-open');
  pendingIssueId = undefined;
  closeIssueDetail();
  clearIssueSelection();
  setNewFormOpen(false);

  teardownIssuesEmbedBeforeChatPaint();

  if (options?.restoreChat === false) {
    notifyAskQuestionDisplayContextChanged();
    return;
  }

  const targetId =
    savedReturnChatId && sessionState?.chats.some((c) => c.id === savedReturnChatId)
      ? savedReturnChatId
      : sessionState?.activeId;
  const chat = targetId ? sessionState?.chats.find((c) => c.id === targetId) : undefined;
  const area = document.getElementById('chatArea');
  if (chat) {
    void import('./messages').then((m) => m.renderChatFromHistory(chat));
  } else if (area) {
    area.replaceChildren();
  }
  notifyAskQuestionDisplayContextChanged();
}

/** Toggle Issues embed from the Code sidebar footer button. */
export function toggleIssuesFromSidebar(): void {
  if (isIssuesEmbeddedInCode()) {
    closeIssuesEmbeddedInCode();
    return;
  }
  void openIssuesEmbeddedInCode();
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

/** Short type label for list chips (B/T/I/N). */
function typeChipLetter(type: IssueType): string {
  return type.slice(0, 1).toUpperCase();
}

/** Build a type badge for list rows. */
function createTypeChip(type: IssueType): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `issues-type-chip issues-type-chip--${type} issues-row__type`;
  chip.textContent = typeChipLetter(type);
  chip.title = type;
  return chip;
}

/** Build a status pill for list rows. */
function createStatusChip(status: IssueStatus): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `issues-status-chip issues-status-chip--${status}`;
  chip.textContent = status.replace(/_/g, ' ');
  return chip;
}

/** Build a priority label for list rows. */
function createPriorityChip(priority: IssuePriority): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `issues-priority-chip issues-priority-chip--${priority}`;
  chip.textContent = priority === 'none' ? '—' : priority;
  return chip;
}

function syncListHeadVisibility(): void {
  const head = document.getElementById('issuesListHead');
  if (!head) return;
  head.hidden = viewMode !== 'list';
}

/** Reflect active sort on list column headers (aria-sort + indicator class). */
function syncListHeadSortUi(): void {
  const head = document.getElementById('issuesListHead');
  if (!head) return;
  head.querySelectorAll<HTMLButtonElement>('.issues-list-head__sort[data-sort-key]').forEach((btn) => {
    const key = btn.dataset.sortKey;
    if (!key || !isIssuesSortKey(key)) return;
    const aria = ariaSortValue(listSort, key);
    btn.setAttribute('aria-sort', aria);
    btn.classList.toggle('is-active', aria !== 'none');
    const dirLabel =
      aria === 'ascending' ? 'ascending' : aria === 'descending' ? 'descending' : 'unsorted';
    btn.setAttribute('aria-label', `Sort by ${ISSUES_SORT_LABELS[key]}, ${dirLabel}`);
  });
}

function isIssuesSortKey(value: string): value is IssuesSortKey {
  return ISSUES_SORT_KEYS.has(value as IssuesSortKey);
}

/** Apply filters, then list-column sort (list view only). */
function collectVisibleIssues(): IssueCard[] {
  const issues = collectIssues(collectOptions());
  if (viewMode !== 'list') return issues;
  return sortIssuesForList(issues, listSort);
}

/** Drop selection entries that are no longer visible under current filters. */
function pruneIssueSelection(visibleIds: Set<string>): void {
  for (const id of selectedIssueIds) {
    if (!visibleIds.has(id)) selectedIssueIds.delete(id);
  }
}

function syncSelectionBar(visibleCount: number): void {
  const bar = document.getElementById('issuesSelectionBar');
  const countEl = document.getElementById('issuesSelectionCount');
  const selectAll = document.getElementById('issuesSelectAll') as HTMLInputElement | null;
  const selectedCount = selectedIssueIds.size;
  if (bar) bar.hidden = selectedCount === 0;
  if (countEl) {
    countEl.textContent =
      selectedCount === 1 ? '1 issue selected' : `${selectedCount} issues selected`;
  }
  if (selectAll) {
    selectAll.indeterminate = selectedCount > 0 && selectedCount < visibleCount;
    selectAll.checked = visibleCount > 0 && selectedCount === visibleCount;
  }
}

function setIssueChecked(issueId: string, checked: boolean): void {
  if (checked) selectedIssueIds.add(issueId);
  else selectedIssueIds.delete(issueId);
}

function clearIssueSelection(): void {
  selectedIssueIds.clear();
  lastSelectionAnchorId = undefined;
}

type IssueSelectionInput = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** When set (checkbox), use this checked state instead of toggling. */
  checked?: boolean;
};

/** Apply multiselect from checkbox or modifier-click on a row/card. */
function handleIssueSelection(
  issue: IssueCard,
  orderedIssues: IssueCard[],
  index: number,
  input: IssueSelectionInput,
): void {
  const modifier = input.ctrlKey || input.metaKey;
  const explicitChecked = input.checked;

  if (
    input.shiftKey &&
    lastSelectionAnchorId &&
    lastSelectionAnchorId !== issue.id
  ) {
    const anchorIndex = orderedIssues.findIndex((row) => row.id === lastSelectionAnchorId);
    if (anchorIndex >= 0) {
      const checked = explicitChecked ?? true;
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      for (let i = start; i <= end; i += 1) {
        setIssueChecked(orderedIssues[i].id, checked);
      }
      return;
    }
  }

  if (modifier || explicitChecked !== undefined || input.shiftKey) {
    if (explicitChecked !== undefined) {
      setIssueChecked(issue.id, explicitChecked);
    } else if (modifier) {
      setIssueChecked(issue.id, !selectedIssueIds.has(issue.id));
    } else {
      setIssueChecked(issue.id, true);
    }
    lastSelectionAnchorId = issue.id;
  }
}

function isIssueMultiSelectClick(event: MouseEvent): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

/** Board visual order: left-to-right columns, top-to-bottom within each column. */
function buildBoardOrderedIssues(
  issues: IssueCard[],
  columns: Array<{ id: IssueStatus; label: string }>,
): IssueCard[] {
  const ordered: IssueCard[] = [];
  for (const col of columns) {
    for (const issue of issues.filter((row) => row.status === col.id)) {
      ordered.push(issue);
    }
  }
  return ordered;
}

/** Create a row/card checkbox that does not open the detail panel. */
function createIssueSelectCheckbox(
  issue: IssueCard,
  options: { orderedIssues: IssueCard[]; index: number },
): HTMLInputElement {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'issues-select-checkbox';
  checkbox.checked = selectedIssueIds.has(issue.id);
  checkbox.setAttribute('aria-label', `Select ${issue.id}`);
  checkbox.addEventListener('click', (event) => event.stopPropagation());
  checkbox.addEventListener('change', (event) => {
    event.stopPropagation();
    const mouse = event as MouseEvent;
    handleIssueSelection(issue, options.orderedIssues, options.index, {
      shiftKey: mouse.shiftKey,
      ctrlKey: mouse.ctrlKey,
      metaKey: mouse.metaKey,
      checked: checkbox.checked,
    });
    renderIssuesPanel();
  });
  return checkbox;
}

function onIssueItemClick(
  event: MouseEvent,
  issue: IssueCard,
  orderedIssues: IssueCard[],
  index: number,
): void {
  if ((event.target as HTMLElement).closest('.issues-select-cell, button')) return;
  if (!isIssueMultiSelectClick(event)) {
    navigateToIssueDetail(issue.id);
    return;
  }
  event.preventDefault();
  handleIssueSelection(issue, orderedIssues, index, {
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  });
  renderIssuesPanel();
}

async function confirmAndDeleteIssues(issueIds: string[]): Promise<void> {
  const ids = [...new Set(issueIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const noun = ids.length === 1 ? 'this issue' : `${ids.length} issues`;
  const ok = await appConfirm(`Delete ${noun}? This cannot be undone.`, {
    confirmLabel: 'Delete',
    title: 'Delete issues',
  });
  if (!ok) return;
  const openId = getSelectedIssueId();
  deleteIssues(ids);
  for (const id of ids) selectedIssueIds.delete(id);
  if (openId && ids.includes(openId)) {
    closeIssueDetail();
    setIssuesRouteHash('#/app/issues');
  }
  renderIssuesPanel();
}

/** Delete one issue from list/detail actions. */
export async function deleteIssueFromUi(issueId: string): Promise<void> {
  await confirmAndDeleteIssues([issueId]);
}

function renderList(mount: HTMLElement, issues: IssueCard[]): void {
  const list = document.createElement('div');
  list.className = 'issues-list';
  list.setAttribute('role', 'list');

  issues.forEach((issue, index) => {
    const row = document.createElement('div');
    row.className = 'issues-row';
    row.setAttribute('role', 'listitem');
    row.dataset.issueId = issue.id;
    row.classList.toggle('is-checked', selectedIssueIds.has(issue.id));

    const selectCell = document.createElement('label');
    selectCell.className = 'issues-select-cell';
    selectCell.appendChild(
      createIssueSelectCheckbox(issue, { orderedIssues: issues, index }),
    );

    const id = document.createElement('span');
    id.className = 'issues-row__id';
    id.textContent = issue.id;

    const type = createTypeChip(issue.type);

    const title = document.createElement('span');
    title.className = 'issues-row__title';
    title.textContent = issue.title;

    const status = createStatusChip(issue.status);
    status.className = `${status.className} issues-row__status`;

    const priority = createPriorityChip(issue.priority);
    priority.className = `${priority.className} issues-row__priority`;

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

    row.append(selectCell, id, type, title, status, priority, labels, updated, actions);
    row.addEventListener('click', (event) => {
      onIssueItemClick(event, issue, issues, index);
    });
    row.classList.toggle('is-selected', getSelectedIssueId() === issue.id);
    row.tabIndex = 0;
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        if ((event.target as HTMLElement).closest('.issues-select-cell')) return;
        event.preventDefault();
        navigateToIssueDetail(issue.id);
      }
    });
    list.appendChild(row);
  });

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
  const boardOrderedIssues = buildBoardOrderedIssues(issues, columns);

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
      const boardIndex = boardOrderedIssues.findIndex((row) => row.id === issue.id);
      const card = document.createElement('article');
      card.className = 'issues-card';
      card.dataset.issueId = issue.id;
      card.classList.toggle('is-checked', selectedIssueIds.has(issue.id));

      const cardHead = document.createElement('div');
      cardHead.className = 'issues-card__head';

      const selectCell = document.createElement('label');
      selectCell.className = 'issues-select-cell issues-card__select';
      selectCell.appendChild(
        createIssueSelectCheckbox(issue, {
          orderedIssues: boardOrderedIssues,
          index: boardIndex,
        }),
      );

      const id = document.createElement('div');
      id.className = 'issues-card__id';
      id.textContent = issue.id;

      cardHead.append(selectCell, id);

      const title = document.createElement('h4');
      title.className = 'issues-card__title';
      title.textContent = issue.title;

      const meta = document.createElement('div');
      meta.className = 'issues-card__meta';
      meta.textContent = `${issue.type} · ${issue.priority}`;

      card.append(cardHead, title, meta);
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
        onIssueItemClick(event, issue, boardOrderedIssues, boardIndex);
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

  const issues = collectVisibleIssues();
  const visibleIds = new Set(issues.map((issue) => issue.id));
  pruneIssueSelection(visibleIds);
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
    summaryEl.textContent = `${issues.length} shown · ${openAll} open`;
  }

  syncListHeadVisibility();
  syncListHeadSortUi();
  syncSelectionBar(issues.length);

  // Deep-link / pending selection opens detail; otherwise refresh if already open.
  if (pendingIssueId) {
    const id = pendingIssueId;
    pendingIssueId = undefined;
    openIssueDetail(id);
  } else if (getSelectedIssueId()) {
    refreshIssueDetailIfOpen();
  }

}

/**
 * Sync the Issues deep-link hash — skipped while embedded in Code so the OS
 * router does not foreground the fullscreen Issues app.
 */
export function setIssuesRouteHash(next: string): void {
  if (isIssuesEmbeddedInCode()) return;
  if (window.location.hash !== next) window.location.hash = next;
}

/** Navigate hash + open detail for an issue. */
function navigateToIssueDetail(issueId: string): void {
  pendingIssueId = issueId;
  openIssueDetail(issueId);
  setIssuesRouteHash(`#/app/issues/${issueId}`);
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

  document.getElementById('issuesSelectAll')?.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const issues = collectVisibleIssues();
    if (input.checked) {
      for (const issue of issues) selectedIssueIds.add(issue.id);
    } else {
      clearIssueSelection();
    }
    renderIssuesPanel();
  });

  document.getElementById('btnIssuesDeleteSelected')?.addEventListener('click', () => {
    void confirmAndDeleteIssues([...selectedIssueIds]);
  });

  document.getElementById('btnIssuesClearSelection')?.addEventListener('click', () => {
    clearIssueSelection();
    renderIssuesPanel();
  });

  // Column header clicks toggle / switch list sort.
  document.getElementById('issuesListHead')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('.issues-list-head__sort[data-sort-key]');
    if (!btn) return;
    const key = btn.dataset.sortKey;
    if (!key || !isIssuesSortKey(key)) return;
    listSort = cycleIssuesListSort(listSort, key);
    renderIssuesPanel();
  });

  // Sidebar: Issues embeds in Code; desktop/dock still launch the fullscreen app.
  document.getElementById('btnAllBugs')?.addEventListener('click', () => {
    openIssuesFromSidebar();
  });
}

/** Open Issues from the chat sidebar footer button. */
export function openIssuesFromSidebar(): void {
  if (shouldEmbedIssuesFromCodeSidebar()) {
    toggleIssuesFromSidebar();
    return;
  }
  if (isOsShellEnabled()) {
    void import('../os/router').then((m) => m.launchApp('issues'));
    return;
  }
  void openIssues();
}

/** Wire listeners; safe to call on every boot. */
export function initIssuesPage(): void {
  if (initialized) return;
  initialized = true;
  mountHeaderIcon();
  bindStaticControls();
  ensureSubscriptions();
  window.addEventListener('hashchange', onHashChange);
  const hash = window.location.hash;
  if (hash === '#/app/issues' || hash.startsWith('#/app/issues/')) {
    void openIssues();
  }
}

export async function openIssues(options?: {
  issueId?: string;
  /** When true, skip OS hash navigation (Code #chatArea embed). */
  embedded?: boolean;
}): Promise<void> {
  const root = getRoot();
  if (!root) return;

  // Fullscreen / dock launch must reclaim the view from a Code embed first.
  if (!options?.embedded && isIssuesEmbeddedInCode()) {
    teardownIssuesEmbedBeforeChatPaint();
  }

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

  if (!options?.embedded && !isOsShellEnabled()) {
    const next = options?.issueId ? `#/app/issues/${options.issueId}` : '#/app/issues';
    if (window.location.hash !== next) window.location.hash = next;
  }
}

export function closeIssues(options?: { skipNavigate?: boolean }): void {
  // Embedded in Code: return to chat without switching the OS foreground app.
  if (isIssuesEmbeddedInCode()) {
    closeIssuesEmbeddedInCode({ restoreChat: !options?.skipNavigate });
    return;
  }

  const root = getRoot();
  if (!root) return;
  root.classList.remove('is-open');
  pendingIssueId = undefined;
  closeIssueDetail();
  clearIssueSelection();
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
  // Code embed owns its own detail panel — ignore Issues hashes while embedded.
  if (isIssuesEmbeddedInCode()) return;
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

