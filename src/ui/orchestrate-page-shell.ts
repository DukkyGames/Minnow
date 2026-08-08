/**
 * Shared Orchestrate page shell (ob-* twin of Super Plan / Research).
 * Builds rail + main chrome used by the hub ask pane and live board run pane.
 */

import { boardSetupStatusLabel } from '../chat/orchestrate/board-setup';
import { getGroupsForWorkspace } from '../state/chat-groups';
import { getBoardProgressPercent } from '../state/orchestrate-board-store';
import { sessionState } from '../state/sessions';
import type { BoardTask, Chat, ChatGroup } from '../types';
import { getWorkspacePath } from '../state/workspace';
import {
  applyChatItemDotClasses,
  getChatItemDotContext,
  resolveChatItemDotState,
} from './chat-item-dot';
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

/** One row in the rail's chat level (planner, task, tester or fixer chat). */
export interface OrchestrateChatRailRow {
  chatId: string;
  title: string;
  /** Mono meta line: task id and role, e.g. `T4 · tester`. */
  meta: string;
  /** Planner sorts first and never sits under a wave. */
  isPlanner: boolean;
  /** Wave this row belongs to; absent for the planner and the final test. */
  wave?: number | string;
}

export interface PaintOrchestrateChatRailOptions {
  group: ChatGroup;
  /** Chat currently open in the main pane. */
  activeChatId?: string | null;
  onSelectChat: (chatId: string) => void;
  /** Return to the board list level. */
  onBack: () => void;
  /** Right-click on a chat row. */
  onChatContextMenu?: (
    chatId: string,
    nameEl: HTMLSpanElement,
    coords: { x: number; y: number },
  ) => void;
  /** Collapsed wave ids (rail-local, so board collapse state is untouched). */
  collapsedWaves?: ReadonlySet<string>;
  onToggleWave?: (waveKey: string) => void;
  filterText?: string;
}

/** Role suffix for a chat's meta line, derived from the task it is linked to. */
function chatRoleForTask(task: BoardTask, chatId: string): string | null {
  if (task.chatId?.trim() === chatId) return 'build';
  if (task.testChatId?.trim() === chatId) return 'tester';
  if (task.fixerChatId?.trim() === chatId) {
    return task.fixerKind === 'env' ? 'env fix' : 'merge fix';
  }
  return null;
}

/**
 * Rows for a board's chats: planner first, then every task-linked chat grouped
 * by wave. Mirrors the sidebar's board folder ordering so moving the list into
 * the rail does not reshuffle what people already learned.
 */
export function listBoardChatRailRows(
  group: ChatGroup,
  chats: readonly Chat[],
): OrchestrateChatRailRow[] {
  const board = group.orchestrateBoard;
  const byId = new Map(chats.map((c) => [c.id, c]));
  const rows: OrchestrateChatRailRow[] = [];
  const seen = new Set<string>();

  const plannerId = group.plannerChatId?.trim();
  if (plannerId && byId.has(plannerId)) {
    rows.push({
      chatId: plannerId,
      title: 'Orchestrator',
      meta: byId.get(plannerId)!.name || 'planner',
      isPlanner: true,
    });
    seen.add(plannerId);
  }

  if (!board) return rows;

  for (const task of board.tasks) {
    const linked = [task.chatId, task.testChatId, task.fixerChatId];
    for (const raw of linked) {
      const chatId = raw?.trim();
      if (!chatId || seen.has(chatId)) continue;
      const chat = byId.get(chatId);
      if (!chat) continue;
      seen.add(chatId);
      const role = chatRoleForTask(task, chatId);
      rows.push({
        chatId,
        title: chat.name?.trim() || task.title || task.id,
        meta: role ? `${task.id} · ${role}` : task.id,
        isPlanner: false,
        wave: task.wave,
      });
    }
  }

  const finalTestId = board.finalTest?.chatId?.trim();
  if (finalTestId && !seen.has(finalTestId) && byId.has(finalTestId)) {
    rows.push({
      chatId: finalTestId,
      title: byId.get(finalTestId)!.name?.trim() || 'Final integration test',
      meta: 'final test',
      isPlanner: false,
    });
  }

  return rows;
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

    const title = el(
      'p',
      'orchestrate-hub__board-empty-title',
      filter ? 'No boards match that filter.' : 'No boards in this workspace yet',
    );
    const hint = el(
      'p',
      'orchestrate-hub__board-empty-hint',
      filter
        ? 'Clear the filter or start a new board from a plan.'
        : 'Start a board from a plan in the main pane.',
    );
    empty.append(title, hint);

    if (!filter && options.onEmptyAction) {
      const focusBtn = el(
        'button',
        'orchestrate-hub__board-empty-action',
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

/** Stable key for a wave id (waves are `number | string`). */
export function waveKey(wave: number | string | undefined): string {
  return wave == null ? 'none' : String(wave);
}

/** Append one chat row; shared by the planner row and each wave's rows. */
function appendChatRailRow(
  container: HTMLElement,
  row: OrchestrateChatRailRow,
  options: PaintOrchestrateChatRailOptions,
  dotCtx: ReturnType<typeof getChatItemDotContext>,
  chat: Chat,
): void {
  const wrap = el('div', 'ob-row-wrap');
  const btn = el('button', 'ob-row ob-row--chat') as HTMLButtonElement;
  btn.type = 'button';
  btn.setAttribute('role', 'listitem');
  btn.dataset.chatId = row.chatId;
  if (row.isPlanner) btn.classList.add('ob-row--planner');
  if (options.activeChatId && options.activeChatId === row.chatId) {
    btn.classList.add('is-active');
    btn.setAttribute('aria-current', 'true');
  }

  const titleEl = el('span', 'ob-row__title') as HTMLSpanElement;
  titleEl.textContent = row.title;

  const meta = el('span', 'ob-row__meta');
  const dot = el('span', 'ob-row__dot chat-item-dot');
  dot.setAttribute('aria-hidden', 'true');
  applyChatItemDotClasses(dot, resolveChatItemDotState(chat, dotCtx), btn);
  meta.append(dot, document.createTextNode(row.meta));

  btn.append(titleEl, meta);
  btn.setAttribute('aria-label', `Open chat: ${row.title}, ${row.meta}`);
  btn.addEventListener('click', () => options.onSelectChat(row.chatId));
  btn.addEventListener('contextmenu', (e) => {
    if (!options.onChatContextMenu) return;
    e.preventDefault();
    options.onChatContextMenu(row.chatId, titleEl, { x: e.clientX, y: e.clientY });
  });

  wrap.appendChild(btn);
  container.appendChild(wrap);
}

/**
 * Paint the rail's chat level for one board: back row, planner, then waves.
 *
 * The rail shows one level at a time. A board with 31 tasks would otherwise
 * bury the board library it sits above, which is the sidebar tree this surface
 * exists to replace.
 */
export function paintOrchestrateChatRail(
  container: HTMLElement,
  options: PaintOrchestrateChatRailOptions,
): void {
  container.replaceChildren();
  const chats = sessionState?.chats ?? [];
  const filter = (options.filterText ?? '').trim().toLowerCase();
  const allRows = listBoardChatRailRows(options.group, chats);
  const rows = filter
    ? allRows.filter(
        (r) =>
          r.title.toLowerCase().includes(filter) || r.meta.toLowerCase().includes(filter),
      )
    : allRows;

  const back = el('button', 'ob-back') as HTMLButtonElement;
  back.type = 'button';
  back.append(el('span', 'ob-back__caret', '‹'), document.createTextNode('All boards'));
  back.setAttribute('aria-label', 'Back to board list');
  back.addEventListener('click', () => options.onBack());
  container.appendChild(back);

  const label = el('span', 'ob-group__label', boardTileTitle(options.group));
  container.appendChild(label);

  if (!rows.length) {
    const empty = el('div', 'ob-rail__empty');
    empty.setAttribute('role', 'status');
    empty.append(
      el(
        'p',
        'orchestrate-hub__board-empty-title',
        filter ? 'No chats match that filter.' : 'No task chats yet',
      ),
      el(
        'p',
        'orchestrate-hub__board-empty-hint',
        filter
          ? 'Clear the filter to see every chat on this board.'
          : 'Start the board and each task opens its own chat here.',
      ),
    );
    container.appendChild(empty);
    return;
  }

  const dotCtx = getChatItemDotContext(sessionState?.activeId ?? null);
  const byId = new Map(chats.map((c) => [c.id, c]));

  for (const row of rows.filter((r) => r.isPlanner)) {
    const chat = byId.get(row.chatId);
    if (chat) appendChatRailRow(container, row, options, dotCtx, chat);
  }

  // Group the rest by wave, in board wave order, then anything unwaved (final test).
  const waved = rows.filter((r) => !r.isPlanner);
  const order: string[] = [];
  const buckets = new Map<string, OrchestrateChatRailRow[]>();
  for (const row of waved) {
    const key = waveKey(row.wave);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(row);
  }

  for (const key of order) {
    const bucket = buckets.get(key)!;
    // A filter that matches only a few rows should show them, not hide them
    // behind a collapsed wave the user cannot see the contents of.
    const collapsed = !filter && (options.collapsedWaves?.has(key) ?? false);

    if (key !== 'none') {
      const head = el('button', 'ob-wave') as HTMLButtonElement;
      head.type = 'button';
      head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      head.append(
        el('span', 'ob-wave__caret', collapsed ? '▸' : '▾'),
        el('span', 'ob-wave__name', `Wave ${key}`),
        el('span', 'ob-wave__count', String(bucket.length)),
      );
      head.addEventListener('click', () => options.onToggleWave?.(key));
      container.appendChild(head);
    }

    if (collapsed) continue;
    for (const row of bucket) {
      const chat = byId.get(row.chatId);
      if (chat) appendChatRailRow(container, row, options, dotCtx, chat);
    }
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
