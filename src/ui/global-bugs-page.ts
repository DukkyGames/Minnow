/**
 * Global bugs screen — Kanban + filters (MIN-16). Bugs are not a chat mode.
 */

import '../styles/global-bugs-page.css';

import {
  collectGlobalBugs,
  countOpenGlobalBugs,
  type GlobalBugScope,
} from '../state/global-bugs.ts';
import { findChatById, sessionState } from '../state/sessions.ts';
import { getWorkspacePath } from '../state/workspace.ts';
import type { BugColumn } from '../types.ts';
import { switchChat } from './sidebar.ts';
import {
  mountGlobalBugKanban,
  refreshGlobalBugKanban,
  setGlobalBugKanbanOptions,
  unmountGlobalBugKanban,
} from './bug-board.ts';
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

function getGlobalBugsRoot(): HTMLElement | null {
  return document.getElementById('globalBugsView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function applyCollectOptions(): void {
  setGlobalBugKanbanOptions({
    scope: filters.scope,
    workspacePath: getWorkspacePath(),
    hideComplete: filters.hideComplete,
    column: filters.column,
  });
}

/** Rebuild kanban + summary from current filters. */
export function renderGlobalBugsList(): void {
  const mount = document.getElementById('globalBugsList');
  const summaryEl = document.getElementById('globalBugsSummary');
  if (!mount || !sessionState) return;

  applyCollectOptions();
  if (!mount.querySelector('.board-root')) {
    mountGlobalBugKanban(mount);
  } else {
    refreshGlobalBugKanban();
  }

  const entries = collectGlobalBugs({
    scope: filters.scope,
    workspacePath: getWorkspacePath(),
    hideComplete: filters.hideComplete,
    column: filters.column,
  });
  const openAll = countOpenGlobalBugs({
    scope: 'all',
    workspacePath: getWorkspacePath(),
  });

  if (summaryEl) {
    summaryEl.textContent = `${entries.length} shown · ${openAll} open across all workspaces`;
  }

  refreshGlobalBugsSidebarBadge();
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

/** Whether the global bugs page is visible. */
export function isGlobalBugsPageOpen(): boolean {
  return getGlobalBugsRoot()?.classList.contains('is-open') ?? false;
}

/** Open linked investigation chat, or do nothing if the bug has no chat yet. */
export function openGlobalBugInChat(chatId: string): void {
  if (!chatId || !findChatById(chatId)) return;
  closeGlobalBugs();
  if (sessionState?.activeId !== chatId) {
    switchChat(chatId);
  }
}

/** Close global bugs and return to chat shell. */
export function closeGlobalBugs(): void {
  const root = getGlobalBugsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
  unmountGlobalBugKanban();
  const mount = document.getElementById('globalBugsList');
  if (mount) mount.innerHTML = '';
  if (window.location.hash.startsWith('#/bugs')) {
    window.location.hash = '#/';
  }
}

/** Open global bugs screen (`#/bugs`). */
export function openGlobalBugs(): void {
  const root = getGlobalBugsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  closeSettings();
  void import('./welcome-page').then((m) => {
    if (m.isWelcomePageOpen()) m.closeWelcome({ skipHash: true });
  });
  void import('./expert-lab-page').then((m) => {
    if (m.isExpertLabPageOpen()) m.closeExpertLab();
  });
  void import('./benchmark-page').then((m) => {
    const benchmarkRoot = document.getElementById('benchmarkView');
    if (benchmarkRoot?.classList.contains('is-open')) m.closeBenchmark();
  });
  void import('../research/panel').then((m) => {
    if (m.isResearchPageOpen()) m.closeResearch();
  });
  root.classList.add('is-open');
  shell.classList.add('hidden');
  document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');
  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );

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
  if (typeof document === 'undefined' || !sessionState) return;
  const badge = document.getElementById('btnAllBugsCount');
  if (!badge) return;
  const openCurrent = countOpenGlobalBugs({
    scope: 'current_workspace',
    workspacePath: getWorkspacePath(),
  });
  badge.textContent = openCurrent > 0 ? String(openCurrent) : '';
  badge.hidden = openCurrent === 0;
}
