/**
 * Global bugs list — all bug cards across session chats (MIN-16 phase 4).
 */

import '../styles/global-bugs-page.css';

import {
  collectGlobalBugs,
  countOpenGlobalBugs,
  type CollectGlobalBugsOptions,
  type GlobalBugEntry,
  type GlobalBugScope,
} from '../state/global-bugs.ts';
import { subscribeBugBoardChanges } from '../state/bug-board-events.ts';
import { sessionState } from '../state/sessions.ts';
import { getWorkspacePath } from '../state/workspace.ts';
import type { BugColumn } from '../types.ts';
import { setChatMode } from './mode-selector.ts';
import { switchChat } from './sidebar.ts';
import { closeSettings } from './settings-page.ts';

export type GlobalBugFilters = {
  scope: GlobalBugScope;
  column: BugColumn | 'all';
  hideComplete: boolean;
};

const DEFAULT_FILTERS: GlobalBugFilters = {
  scope: 'current_workspace',
  column: 'all',
  hideComplete: true,
};

let filters: GlobalBugFilters = { ...DEFAULT_FILTERS };
let unsubBugChanges: (() => void) | null = null;
const bugChangeUnsubs = new Map<string, () => void>();

function getGlobalBugsRoot(): HTMLElement | null {
  return document.getElementById('globalBugsView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function collectOptions(): CollectGlobalBugsOptions {
  return {
    scope: filters.scope,
    workspacePath: getWorkspacePath(),
    hideComplete: filters.hideComplete,
    column: filters.column,
  };
}

function disposeBugSubscriptions(): void {
  unsubBugChanges?.();
  unsubBugChanges = null;
  for (const fn of bugChangeUnsubs.values()) fn();
  bugChangeUnsubs.clear();
}

function ensureBugSubscriptions(): void {
  if (!sessionState) return;
  const needed = new Set<string>();
  for (const chat of sessionState.chats) {
    if (!chat.bugBoard?.bugs.length) continue;
    needed.add(chat.id);
    if (!bugChangeUnsubs.has(chat.id)) {
      const unsub = subscribeBugBoardChanges(chat.id, () => {
        if (getGlobalBugsRoot()?.classList.contains('is-open')) {
          renderGlobalBugsList();
        }
      });
      bugChangeUnsubs.set(chat.id, unsub);
    }
  }
  for (const [chatId, unsub] of bugChangeUnsubs) {
    if (!needed.has(chatId)) {
      unsub();
      bugChangeUnsubs.delete(chatId);
    }
  }
}

function columnLabel(column: BugColumn): string {
  const labels: Record<BugColumn, string> = {
    reported: 'Reported',
    investigating: 'Investigating',
    planned: 'Planned',
    fixing: 'Fixing',
    complete: 'Complete',
  };
  return labels[column] ?? column;
}

function severityClass(severity: string): string {
  return `global-bugs-severity global-bugs-severity--${severity}`;
}

function renderEmptyState(mount: HTMLElement): void {
  mount.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'global-bugs-empty';
  empty.textContent =
    'No bugs match these filters. File bugs from Bugs mode on any chat, or widen the workspace filter.';
  mount.appendChild(empty);
}

function renderGlobalBugsTable(mount: HTMLElement, entries: GlobalBugEntry[]): void {
  mount.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'global-bugs-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Title</th>
        <th scope="col">Severity</th>
        <th scope="col">Column</th>
        <th scope="col">Chat</th>
        <th scope="col">Workspace</th>
        <th scope="col">Updated</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');

  for (const entry of entries) {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute(
      'aria-label',
      `Open ${entry.bug.title} in ${entry.chatName}`,
    );

    const titleTd = document.createElement('td');
    titleTd.className = 'global-bugs-table__title';
    titleTd.textContent = entry.bug.title;

    const sevTd = document.createElement('td');
    const sevSpan = document.createElement('span');
    sevSpan.className = severityClass(entry.bug.severity);
    sevSpan.textContent = entry.bug.severity;
    sevTd.appendChild(sevSpan);

    const colTd = document.createElement('td');
    colTd.textContent = columnLabel(entry.bug.column);

    const chatTd = document.createElement('td');
    chatTd.textContent = entry.chatName;

    const wsTd = document.createElement('td');
    wsTd.className = 'global-bugs-table__workspace';
    wsTd.textContent = entry.workspacePath.trim()
      ? entry.workspacePath.replace(/^.*\//, '') || entry.workspacePath
      : 'Unassigned';

    const updatedTd = document.createElement('td');
    updatedTd.className = 'global-bugs-table__updated';
    updatedTd.textContent = new Date(entry.bug.updatedAt).toLocaleString();

    tr.append(titleTd, sevTd, colTd, chatTd, wsTd, updatedTd);

    const open = () => void openGlobalBugInChat(entry.chatId, entry.bug.id);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  mount.appendChild(table);
}

/** Rebuild list + summary from current filters. */
export function renderGlobalBugsList(): void {
  const listMount = document.getElementById('globalBugsList');
  const summaryEl = document.getElementById('globalBugsSummary');
  if (!listMount || !sessionState) return;

  ensureBugSubscriptions();
  const entries = collectGlobalBugs(sessionState.chats, collectOptions());
  const openAll = countOpenGlobalBugs(sessionState.chats, {
    scope: 'all',
    workspacePath: getWorkspacePath(),
  });

  if (summaryEl) {
    summaryEl.textContent = `${entries.length} shown · ${openAll} open across all workspaces`;
  }

  const badge = document.getElementById('btnAllBugsCount');
  if (badge) {
    const openCurrent = countOpenGlobalBugs(sessionState.chats, {
      scope: 'current_workspace',
      workspacePath: getWorkspacePath(),
    });
    badge.textContent = openCurrent > 0 ? String(openCurrent) : '';
    badge.hidden = openCurrent === 0;
  }

  if (!entries.length) {
    renderEmptyState(listMount);
    return;
  }
  renderGlobalBugsTable(listMount, entries);
}

function syncFilterControls(): void {
  const scopeSel = document.getElementById(
    'globalBugsScope',
  ) as HTMLSelectElement | null;
  const columnSel = document.getElementById(
    'globalBugsColumn',
  ) as HTMLSelectElement | null;
  const hideComplete = document.getElementById(
    'globalBugsHideComplete',
  ) as HTMLInputElement | null;
  if (scopeSel) scopeSel.value = filters.scope;
  if (columnSel) columnSel.value = filters.column;
  if (hideComplete) hideComplete.checked = filters.hideComplete;
}

/** Switch to owning chat and show bug on the board. */
export async function openGlobalBugInChat(
  chatId: string,
  bugId: string,
): Promise<void> {
  closeGlobalBugs();
  switchChat(chatId);
  const modeResult = setChatMode('debug');
  if (!modeResult.ok) return;

  const chat = sessionState?.chats.find((c) => c.id === chatId);
  if (!chat) return;
  chat.viewMode = 'board';
  const { touchChat, scheduleSaveSessions } = await import('../state/sessions.ts');
  touchChat(chat);
  scheduleSaveSessions();
  const { renderBugBoardView } = await import('./bug-board.ts');
  renderBugBoardView(chat);
  const { syncViewModeToggleFromActiveChat } = await import('./view-mode-toggle.ts');
  syncViewModeToggleFromActiveChat();

  const card = document.querySelector(
    `.bug-task-card[data-bug-id="${CSS.escape(bugId)}"]`,
  );
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Whether the global bugs page is visible. */
export function isGlobalBugsPageOpen(): boolean {
  return getGlobalBugsRoot()?.classList.contains('is-open') ?? false;
}

/** Close global bugs and return to chat shell. */
export function closeGlobalBugs(): void {
  const root = getGlobalBugsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  document.querySelector('header.topbar')?.classList.remove('hidden');
  disposeBugSubscriptions();
  if (window.location.hash.startsWith('#/bugs')) {
    window.location.hash = '#/';
  }
}

/** Open global bugs list (`#/bugs`). */
export function openGlobalBugs(): void {
  const root = getGlobalBugsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  closeSettings();
  root.classList.add('is-open');
  shell.classList.add('hidden');
  document.querySelector('header.topbar')?.classList.add('hidden');
  document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');

  syncFilterControls();
  renderGlobalBugsList();

  const nextHash = '#/bugs';
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

function onFilterChange(): void {
  const scopeSel = document.getElementById(
    'globalBugsScope',
  ) as HTMLSelectElement | null;
  const columnSel = document.getElementById(
    'globalBugsColumn',
  ) as HTMLSelectElement | null;
  const hideComplete = document.getElementById(
    'globalBugsHideComplete',
  ) as HTMLInputElement | null;

  filters = {
    scope: (scopeSel?.value === 'all' ? 'all' : 'current_workspace') as GlobalBugScope,
    column: (columnSel?.value ?? 'all') as BugColumn | 'all',
    hideComplete: hideComplete?.checked ?? true,
  };
  renderGlobalBugsList();
}

let staticBindingsDone = false;

function bindStaticControls(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  document
    .getElementById('btnGlobalBugsBack')
    ?.addEventListener('click', () => closeGlobalBugs());

  document.getElementById('globalBugsScope')?.addEventListener('change', onFilterChange);
  document.getElementById('globalBugsColumn')?.addEventListener('change', onFilterChange);
  document
    .getElementById('globalBugsHideComplete')
    ?.addEventListener('change', onFilterChange);

  document.getElementById('btnAllBugs')?.addEventListener('click', () => openGlobalBugs());
}

function onHashChange(): void {
  if (window.location.hash.startsWith('#/bugs')) {
    openGlobalBugs();
    return;
  }
  if (isGlobalBugsPageOpen()) {
    closeGlobalBugs();
  }
}

/** Wire sidebar button, filters, and hash routing. */
export function initGlobalBugsPage(): void {
  bindStaticControls();
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.startsWith('#/bugs')) {
    openGlobalBugs();
  }
}

/** Refresh sidebar badge count (call after bug board changes). */
export function refreshGlobalBugsSidebarBadge(): void {
  if (!sessionState) return;
  const badge = document.getElementById('btnAllBugsCount');
  if (!badge) return;
  const openCurrent = countOpenGlobalBugs(sessionState.chats, {
    scope: 'current_workspace',
    workspacePath: getWorkspacePath(),
  });
  badge.textContent = openCurrent > 0 ? String(openCurrent) : '';
  badge.hidden = openCurrent === 0;
}
