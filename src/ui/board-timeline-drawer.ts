/**
 * Slide-over chronological board event log for orchestrate runs.
 */

import { subscribeBoardChanges } from '../state/orchestrate-board-events.ts';
import { sessionState } from '../state/sessions.ts';
import type { BoardLogEvent, BoardLogEventType, BoardLogLevel } from '../types.ts';

const MILESTONE_TYPES = new Set<BoardLogEventType>([
  'board_init',
  'mode_change',
  'auto_start',
  'auto_stop',
  'task_status',
  'task_started',
  'build_verdict',
  'test_verdict',
  'merge_result',
  'worktree_allocated',
  'worktree_released',
  'task_retry',
  'task_error',
  'final_test_started',
  'final_test_verdict',
]);

const FINE_GRAINED_TYPES = new Set<BoardLogEventType>([
  'tool_call',
  'terminal_run',
  'dev_server',
]);

interface OpenTimelineState {
  groupId: string;
  scroll: HTMLElement;
  listBody: HTMLElement;
  levelFilter: BoardLogLevel | 'all';
  typeGroup: 'all' | 'milestones' | 'tools';
  taskFilter: string;
  lastRenderedId: string | null;
  userScrolledUp: boolean;
  tickerId: ReturnType<typeof setInterval> | null;
  unsubBoard: (() => void) | null;
}

let openLayer: { backdrop: HTMLElement; onKey: (e: KeyboardEvent) => void } | null = null;
let openTimeline: OpenTimelineState | null = null;

function resolveGroup(groupId: string) {
  return sessionState?.groups?.find((g) => g.id === groupId);
}

function formatRelativeTime(ts: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - ts);
  if (delta < 5000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function formatAbsoluteTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function eventMatchesFilters(event: BoardLogEvent, state: OpenTimelineState): boolean {
  if (state.levelFilter !== 'all' && event.level !== state.levelFilter) return false;
  if (state.typeGroup === 'milestones' && !MILESTONE_TYPES.has(event.type)) return false;
  if (state.typeGroup === 'tools' && !FINE_GRAINED_TYPES.has(event.type)) return false;
  if (state.taskFilter !== 'all' && event.taskId !== state.taskFilter) return false;
  return true;
}

function renderDetailBlock(detail: BoardLogEvent['detail']): HTMLElement | null {
  if (!detail || !Object.keys(detail).length) return null;
  const details = document.createElement('details');
  details.className = 'board-timeline-drawer__detail';
  const summary = document.createElement('summary');
  summary.textContent = 'Details';
  details.appendChild(summary);
  const pre = document.createElement('pre');
  pre.className = 'board-timeline-drawer__detail-json';
  pre.textContent = JSON.stringify(detail, null, 2);
  details.appendChild(pre);
  return details;
}

function buildTimelineRow(event: BoardLogEvent, nowMs: number): HTMLElement {
  const row = document.createElement('article');
  row.className = `board-timeline-drawer__row board-timeline-drawer__row--${event.level}`;
  row.dataset.eventId = event.id;

  const dot = document.createElement('span');
  dot.className = 'board-timeline-drawer__level-dot';
  dot.setAttribute('aria-hidden', 'true');

  const meta = document.createElement('div');
  meta.className = 'board-timeline-drawer__row-meta';

  const time = document.createElement('time');
  time.className = 'board-timeline-drawer__time';
  time.dateTime = new Date(event.ts).toISOString();
  time.textContent = formatRelativeTime(event.ts, nowMs);
  time.title = formatAbsoluteTime(event.ts);

  const typeChip = document.createElement('span');
  typeChip.className = 'board-timeline-drawer__type-chip';
  typeChip.textContent = event.type;

  meta.appendChild(dot);
  meta.appendChild(time);
  meta.appendChild(typeChip);

  if (event.taskId) {
    const taskChip = document.createElement('span');
    taskChip.className = 'board-timeline-drawer__task-chip';
    taskChip.textContent = event.taskId;
    meta.appendChild(taskChip);
  }

  const message = document.createElement('p');
  message.className = 'board-timeline-drawer__message';
  message.textContent = event.message;

  row.appendChild(meta);
  row.appendChild(message);

  const detailBlock = renderDetailBlock(event.detail);
  if (detailBlock) row.appendChild(detailBlock);

  return row;
}

function refreshRelativeTimes(state: OpenTimelineState): void {
  const nowMs = Date.now();
  for (const timeEl of state.listBody.querySelectorAll('.board-timeline-drawer__time')) {
    const row = timeEl.closest('.board-timeline-drawer__row') as HTMLElement | null;
    const tsRaw = row?.dataset.eventTs;
    if (!tsRaw) continue;
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) continue;
    timeEl.textContent = formatRelativeTime(ts, nowMs);
  }
}

function appendTimelineEvents(state: OpenTimelineState, events: BoardLogEvent[]): void {
  const nowMs = Date.now();
  const scroll = state.scroll;
  const wasPinnedBottom =
    !state.userScrolledUp &&
    scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;

  for (const event of events) {
    if (!eventMatchesFilters(event, state)) continue;
    if (state.listBody.querySelector(`[data-event-id="${event.id}"]`)) continue;
    const row = buildTimelineRow(event, nowMs);
    row.dataset.eventId = event.id;
    row.dataset.eventTs = String(event.ts);
    state.listBody.appendChild(row);
    state.lastRenderedId = event.id;
  }

  const rowCount = state.listBody.querySelectorAll('.board-timeline-drawer__row').length;
  if (rowCount === 0) {
    state.listBody.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'board-timeline-drawer__empty';
    empty.textContent = 'No board activity logged yet.';
    state.listBody.appendChild(empty);
  } else {
    state.listBody.querySelector('.board-timeline-drawer__empty')?.remove();
  }

  if (wasPinnedBottom) {
    scroll.scrollTop = scroll.scrollHeight;
  }
}

function renderTimelineList(state: OpenTimelineState): void {
  const group = resolveGroup(state.groupId);
  const log = group?.orchestrateBoard?.log ?? [];
  state.listBody.replaceChildren();
  state.lastRenderedId = null;
  appendTimelineEvents(state, log);
}

function bindTimelineLiveSubscription(state: OpenTimelineState): void {
  if (state.unsubBoard) return;
  state.unsubBoard = subscribeBoardChanges(state.groupId, () => {
    if (!openTimeline || openTimeline.groupId !== state.groupId) return;
    const group = resolveGroup(state.groupId);
    const log = group?.orchestrateBoard?.log ?? [];
    if (!log.length) return;

    let startIdx = 0;
    if (state.lastRenderedId) {
      const idx = log.findIndex((e) => e.id === state.lastRenderedId);
      if (idx < 0) {
        renderTimelineList(state);
        return;
      }
      startIdx = idx + 1;
    }
    if (startIdx >= log.length) return;
    appendTimelineEvents(state, log.slice(startIdx));
  });
}

function wireScrollPin(state: OpenTimelineState): void {
  state.scroll.addEventListener('scroll', () => {
    const gap = state.scroll.scrollHeight - state.scroll.scrollTop - state.scroll.clientHeight;
    state.userScrolledUp = gap > 48;
  });
}

function buildFilterBar(state: OpenTimelineState, onFilterChange: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'board-timeline-drawer__filters';

  const levelLabel = document.createElement('label');
  levelLabel.className = 'board-timeline-drawer__filter';
  levelLabel.textContent = 'Level';
  const levelSelect = document.createElement('select');
  levelSelect.className = 'board-timeline-drawer__filter-select';
  levelSelect.setAttribute('aria-label', 'Filter by level');
  for (const opt of [
    { value: 'all', label: 'All' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warn' },
    { value: 'error', label: 'Error' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    levelSelect.appendChild(option);
  }
  levelSelect.value = state.levelFilter;
  levelSelect.addEventListener('change', () => {
    state.levelFilter = levelSelect.value as BoardLogLevel | 'all';
    onFilterChange();
  });
  levelLabel.appendChild(levelSelect);

  const typeLabel = document.createElement('label');
  typeLabel.className = 'board-timeline-drawer__filter';
  typeLabel.textContent = 'Type';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'board-timeline-drawer__filter-select';
  typeSelect.setAttribute('aria-label', 'Filter by event type group');
  for (const opt of [
    { value: 'all', label: 'All' },
    { value: 'milestones', label: 'Milestones' },
    { value: 'tools', label: 'Tools / terminal' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    typeSelect.appendChild(option);
  }
  typeSelect.value = state.typeGroup;
  typeSelect.addEventListener('change', () => {
    state.typeGroup = typeSelect.value as OpenTimelineState['typeGroup'];
    onFilterChange();
  });
  typeLabel.appendChild(typeSelect);

  const taskLabel = document.createElement('label');
  taskLabel.className = 'board-timeline-drawer__filter';
  taskLabel.textContent = 'Task';
  const taskSelect = document.createElement('select');
  taskSelect.className = 'board-timeline-drawer__filter-select';
  taskSelect.setAttribute('aria-label', 'Filter by task');
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All tasks';
  taskSelect.appendChild(allOpt);
  const group = resolveGroup(state.groupId);
  for (const task of group?.orchestrateBoard?.tasks ?? []) {
    const option = document.createElement('option');
    option.value = task.id;
    option.textContent = `${task.id} — ${task.title}`;
    taskSelect.appendChild(option);
  }
  taskSelect.value = state.taskFilter;
  taskSelect.addEventListener('change', () => {
    state.taskFilter = taskSelect.value;
    onFilterChange();
  });
  taskLabel.appendChild(taskSelect);

  bar.appendChild(levelLabel);
  bar.appendChild(typeLabel);
  bar.appendChild(taskLabel);
  return bar;
}

export function countBoardLogAlerts(groupId: string): { warn: number; error: number } {
  const log = resolveGroup(groupId)?.orchestrateBoard?.log ?? [];
  let warn = 0;
  let error = 0;
  for (const event of log) {
    if (event.level === 'warn') warn += 1;
    if (event.level === 'error') error += 1;
  }
  return { warn, error };
}

export function closeBoardTimelineDrawer(): void {
  if (openTimeline?.tickerId != null) {
    clearInterval(openTimeline.tickerId);
  }
  if (openTimeline?.unsubBoard) {
    openTimeline.unsubBoard();
  }
  openTimeline = null;
  if (!openLayer) return;
  document.removeEventListener('keydown', openLayer.onKey);
  openLayer.backdrop.remove();
  openLayer = null;
}

/** Open the board timeline drawer for one folder group. */
export function openBoardTimelineDrawer(groupId: string): void {
  closeBoardTimelineDrawer();
  const main = document.getElementById('mainColumn');
  if (!main) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'board-timeline-drawer-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const panel = document.createElement('div');
  panel.className = 'board-timeline-drawer-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Board timeline');

  const header = document.createElement('header');
  header.className = 'board-timeline-drawer__header';

  const title = document.createElement('h2');
  title.className = 'board-timeline-drawer__title';
  title.textContent = 'Board timeline';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'board-timeline-drawer__icon-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => closeBoardTimelineDrawer());

  header.appendChild(title);
  header.appendChild(closeBtn);

  const state: OpenTimelineState = {
    groupId,
    scroll: document.createElement('div'),
    listBody: document.createElement('div'),
    levelFilter: 'all',
    typeGroup: 'all',
    taskFilter: 'all',
    lastRenderedId: null,
    userScrolledUp: false,
    tickerId: null,
    unsubBoard: null,
  };

  state.scroll.className = 'board-timeline-drawer__scroll';
  state.listBody.className = 'board-timeline-drawer__list';

  const onFilterChange = (): void => {
    renderTimelineList(state);
  };

  const filters = buildFilterBar(state, onFilterChange);

  state.scroll.appendChild(state.listBody);
  panel.appendChild(header);
  panel.appendChild(filters);
  panel.appendChild(state.scroll);
  backdrop.appendChild(panel);
  main.appendChild(backdrop);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBoardTimelineDrawer();
    }
  };
  document.addEventListener('keydown', onKey);
  openLayer = { backdrop, onKey };
  openTimeline = state;

  wireScrollPin(state);
  renderTimelineList(state);
  bindTimelineLiveSubscription(state);
  state.tickerId = setInterval(() => {
    if (!openTimeline || openTimeline.groupId !== groupId) return;
    refreshRelativeTimes(openTimeline);
  }, 1000);
  if (state.tickerId != null && typeof state.tickerId === 'object' && 'unref' in state.tickerId) {
    (state.tickerId as { unref: () => void }).unref();
  }

  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeBoardTimelineDrawer();
  });

  closeBtn.focus();
  state.scroll.scrollTop = state.scroll.scrollHeight;
}
