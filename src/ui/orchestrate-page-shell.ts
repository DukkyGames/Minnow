/**
 * Shared Orchestrate page shell (ob-* twin of Super Plan / Research).
 * Builds rail + main chrome used by the hub ask pane and live board run pane.
 */

import { boardSetupStatusLabel } from '../chat/orchestrate/board-setup';
import { getGroupsForWorkspace } from '../state/chat-groups';
import { getBoardProgressPercent } from '../state/orchestrate-board-store';
import { sessionState } from '../state/sessions';
import type { ChatGroup } from '../types';
import { getWorkspacePath } from '../state/workspace';
import { shortPlanLabel } from './orchestrate-plan-picker';

/** Boards/plans linked to this workspace (shared with hub list helpers). */
function listWorkspaceBoards(workspacePath: string): ChatGroup[] {
  if (!sessionState) return [];
  return getGroupsForWorkspace(workspacePath)
    .filter(
      (group) =>
        Boolean(group.orchestrateBoard) || Boolean(group.orchestratePlanPath?.trim()),
    )
    .sort((a, b) => boardGroupSortKey(b) - boardGroupSortKey(a));
}

/** Root class for the Orchestrate library-first page. */
export const OB_PAGE_CLASS = 'ob-page';
/** Edge-to-edge chat-area class (alias kept for hub tests: chat-area--orchestrate-hub). */
export const OB_CHAT_AREA_CLASS = 'chat-area--orchestrate';

export interface OrchestratePageShellParts {
  page: HTMLElement;
  shell: HTMLElement;
  rail: HTMLElement;
  railList: HTMLElement;
  main: HTMLElement;
  filterInput: HTMLInputElement;
}

export interface PaintOrchestrateRailOptions {
  /** Currently open board group id (marks active row). */
  activeGroupId?: string | null;
  /** Called when the user picks a board row. */
  onSelectBoard: (groupId: string, plannerChatId?: string) => void;
  /** Focus target for empty-state CTA (usually the plan select). */
  onEmptyAction?: () => void;
  /** Optional filter string (lowercase). */
  filterText?: string;
}

/** Tiny DOM helper matching Super Plan’s `el` pattern. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Relative time for rail meta (same cadence as the old hub list). */
function formatRelativeTime(ts: number): string {
  if (!ts) return '—';
  const delta = Date.now() - ts;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function boardGroupSortKey(group: ChatGroup): number {
  const boardUpdated = group.orchestrateBoard?.lastUpdatedAt;
  if (typeof boardUpdated === 'number' && boardUpdated > 0) return boardUpdated;
  return group.createdAt;
}

function boardTileTitle(group: ChatGroup): string {
  const path = group.orchestratePlanPath?.trim();
  if (path) return shortPlanLabel(path);
  if (group.name?.trim()) return group.name.trim();
  return 'Board';
}

/**
 * Build the empty Orchestrate page chrome: `.ob-page > .ob-shell > rail + main`.
 * Caller fills `main` (ask or run) and paints the rail.
 */
export function buildOrchestratePageShell(options: {
  rootId: string;
  ariaLabel: string;
  /** Extra root classes (e.g. legacy hub-root for gradual migrate). */
  extraRootClass?: string;
  onNewBoard: () => void;
}): OrchestratePageShellParts {
  const page = el('div', `${OB_PAGE_CLASS}${options.extraRootClass ? ` ${options.extraRootClass}` : ''}`);
  page.id = options.rootId;
  page.setAttribute('role', 'region');
  page.setAttribute('aria-label', options.ariaLabel);

  const shell = el('div', 'ob-shell');

  const rail = el('aside', 'ob-rail');
  rail.setAttribute('aria-label', 'Boards');

  const head = el('div', 'ob-rail__head');
  const newBtn = el('button', 'ob-new');
  newBtn.type = 'button';
  newBtn.textContent = 'New board';
  newBtn.addEventListener('click', () => options.onNewBoard());

  const collapse = el('button', 'ob-rail__collapse');
  collapse.type = 'button';
  collapse.setAttribute('aria-label', 'Hide board list');
  collapse.textContent = '‹';
  collapse.addEventListener('click', () => {
    page.classList.toggle('is-rail-hidden');
  });
  head.append(newBtn, collapse);

  const filterWrap = el('div', 'ob-rail__filter');
  const filterInput = el('input', 'ob-rail__filter-input') as HTMLInputElement;
  filterInput.type = 'search';
  filterInput.placeholder = 'Filter boards';
  filterInput.setAttribute('aria-label', 'Filter boards');
  filterWrap.appendChild(filterInput);

  const railList = el('div', 'ob-rail__list');
  // Dual-class: hub tests still look for .orchestrate-hub__board-list
  railList.classList.add('orchestrate-hub__board-list');
  railList.id = 'orchestrateHubBoardsRow';
  railList.setAttribute('role', 'list');

  rail.append(head, filterWrap, railList);

  const main = el('div', 'ob-main');
  shell.append(rail, main);
  page.appendChild(shell);

  // Auto-collapse rail when the page is narrow (Super Plan pattern).
  if (typeof ResizeObserver === 'function') {
    let wasNarrow: boolean | null = null;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      const narrow = width < 660;
      if (narrow === wasNarrow) return;
      wasNarrow = narrow;
      page.classList.toggle('is-rail-hidden', narrow);
    });
    observer.observe(page);
    (page as HTMLElement & { __obRailObserver?: ResizeObserver }).__obRailObserver =
      observer;
  }

  return { page, shell, rail, railList, main, filterInput };
}

/** Disconnect rail ResizeObserver when tearing down a page root. */
export function disposeOrchestratePageShell(page: HTMLElement | null): void {
  if (!page) return;
  const observer = (page as HTMLElement & { __obRailObserver?: ResizeObserver })
    .__obRailObserver;
  observer?.disconnect();
  delete (page as HTMLElement & { __obRailObserver?: ResizeObserver }).__obRailObserver;
}

/**
 * Paint board library rows into the rail list.
 * Dual-classes keep orchestrate-hub tests green during the migrate.
 */
export function paintOrchestrateBoardRail(
  container: HTMLElement,
  options: PaintOrchestrateRailOptions,
): void {
  container.replaceChildren();
  const workspacePath = getWorkspacePath();
  const all = listWorkspaceBoards(workspacePath);
  const filter = (options.filterText ?? '').trim().toLowerCase();
  const boards = filter
    ? all.filter((g) => {
        const title = boardTileTitle(g).toLowerCase();
        const path = (g.orchestratePlanPath ?? '').toLowerCase();
        return title.includes(filter) || path.includes(filter);
      })
    : all;

  if (!boards.length) {
    const empty = el('div', 'ob-rail__empty orchestrate-hub__board-empty');
    empty.setAttribute('role', 'status');

    const copy = el('p', 'ob-rail__empty-copy');
    copy.textContent = filter
      ? 'No boards match that filter. Clear it or start a board from a plan.'
      : 'No boards yet. Pick a plan in the main pane to start one.';
    empty.appendChild(copy);

    if (!filter && options.onEmptyAction) {
      const focusBtn = el(
        'button',
        'ob-rail__empty-link',
        'Choose a plan',
      ) as HTMLButtonElement;
      focusBtn.type = 'button';
      focusBtn.addEventListener('click', () => options.onEmptyAction?.());
      empty.appendChild(focusBtn);
    }

    container.appendChild(empty);
    return;
  }

  const label = el('span', 'ob-group__label', 'Boards');
  container.appendChild(label);

  for (const group of boards) {
    const title = boardTileTitle(group);
    const when = formatRelativeTime(boardGroupSortKey(group));
    const statusLabel = group.orchestrateBoard
      ? 'Board'
      : boardSetupStatusLabel(group);
    const board = group.orchestrateBoard;
    const progressPct = board ? getBoardProgressPercent(board) : 0;
    const taskCount = board?.tasks.length ?? 0;

    const wrap = el('div', 'ob-row-wrap');
    const row = el('button', 'ob-row orchestrate-hub__board-row') as HTMLButtonElement;
    row.type = 'button';
    row.setAttribute('role', 'listitem');
    if (options.activeGroupId && group.id === options.activeGroupId) {
      row.classList.add('is-active');
      row.setAttribute('aria-current', 'true');
    }

    const titleEl = el('span', 'ob-row__title orchestrate-hub__board-row-title', title);
    const meta = el('span', 'ob-row__meta orchestrate-hub__board-row-meta');
    const chip = el('span', 'ob-state orchestrate-hub__board-row-chip', statusLabel);
    meta.appendChild(chip);
    const bits = [when];
    if (board && taskCount > 0) bits.push(`${progressPct}%`);
    meta.appendChild(document.createTextNode(` · ${bits.join(' · ')}`));

    row.append(titleEl, meta);
    row.setAttribute(
      'aria-label',
      `${title}, ${statusLabel}, updated ${when}`,
    );
    row.addEventListener('click', () => {
      // Collapse overlay rail on narrow layouts after pick (SP pattern).
      const page = container.closest('.ob-page');
      if (page && page.clientWidth > 0 && page.clientWidth < 660) {
        page.classList.add('is-rail-hidden');
      }
      options.onSelectBoard(group.id, group.plannerChatId);
    });
    wrap.appendChild(row);
    container.appendChild(wrap);
  }
}

/** Resolve the board-root mount node inside an ob-shell (or #chatArea fallback). */
export function getOrchestrateBoardRootHost(area: HTMLElement): HTMLElement {
  const main = area.querySelector(':scope > .ob-page > .ob-shell > .ob-main');
  if (main instanceof HTMLElement) return main;
  return area;
}

/** Find the mounted `.board-root` whether nested under ob-main or direct on area. */
export function queryMountedBoardRoot(area: HTMLElement): HTMLElement | null {
  const nested = area.querySelector(
    ':scope > .ob-page > .ob-shell > .ob-main > .board-root',
  );
  if (nested instanceof HTMLElement) return nested;
  const direct = area.querySelector(':scope > .board-root');
  return direct instanceof HTMLElement ? direct : null;
}
