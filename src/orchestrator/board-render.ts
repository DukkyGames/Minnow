import type { BoardState, TaskState } from '../../server/orchestrator/core/types';
import { reopenTargets } from '../../server/orchestrator/core/plan.js';
import type { DiffLine } from '../chat/prompts/text-diff';
import type { EngineError, TaskFileStat } from './client';
import {
  bucketWave,
  COLUMNS,
  columnOf,
  groupByWave,
  isBlocked,
  type ColumnId,
} from './board-columns';
import { el, empty, field, pill } from './dom';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BoardActions {
  startTask: (taskId: string) => void;
  abandonTask: (taskId: string) => void;
  rerun: (taskIds?: string[]) => void;
  select: (taskId: string | null) => void;
  openTranscript: (attemptId: string) => void;
  toggleFileDiff: (path: string) => void;
  openFile: (path: string) => void;
}

export interface TranscriptView {
  attemptId: string;
  status: 'loading' | 'ready' | 'error';
  events: readonly Record<string, unknown>[];
  truncated: boolean;
  capped: boolean;
  error?: string;
}

export interface FileDiffView {
  status: 'loading' | 'ready' | 'error';
  lines: readonly DiffLine[];
  truncated: boolean;
  error?: string;
}

export interface TaskFilesView {
  taskId: string;
  status: 'loading' | 'ready' | 'error';
  source: 'merged' | 'planned';
  files: readonly TaskFileStat[];
  additions: number;
  deletions: number;
  truncated: boolean;
  error?: string;
  diffs: ReadonlyMap<string, FileDiffView>;
  expanded: ReadonlySet<string>;
}

export interface BoardViewOptions {
  selectedTaskId: string | null;
  pendingTaskIds: ReadonlySet<string>;
  liveHeadlines?: ReadonlyMap<string, { role: string; text: string }>;
  engineErrors?: ReadonlyMap<string, EngineError>;
  transcript?: TranscriptView | null;
  files?: TaskFilesView | null;
}

// ── Tones ────────────────────────────────────────────────────────────────────

export const PHASE_TONE: Record<TaskState['phase'], 'neutral' | 'live' | 'good' | 'warn' | 'bad'> = {
  idle: 'neutral',
  building: 'live',
  testing: 'live',
  merging: 'live',
  merged: 'good',
  abandoned: 'bad',
  skipped: 'warn',
};

export const OUTCOME_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad'> = {
  pass: 'good',
  fail: 'bad',
  blocked: 'warn',
  no_report: 'warn',
  crashed: 'bad',
  timeout: 'bad',
  conflicted: 'warn',
};

export function phaseLabel(state: BoardState, task: TaskState): string {
  if (task.phase === 'idle' && isBlocked(state, task)) return 'blocked';
  if (task.phase === 'idle' && task.attempts.length > 0) return 'waiting';
  return task.phase;
}

// ── Header ───────────────────────────────────────────────────────────────────

export function renderBoardHeader(
  state: BoardState,
  connected: boolean,
  controls?: HTMLElement,
): HTMLElement {
  const header = el('header', 'board-header ob-runhead');

  const toolbar = el('div', 'board-header__toolbar');
  const leading = el('div', 'board-header__leading');

  const title = el('h2', 'board-header__title', state.name || state.boardId);
  title.title = state.planPath;
  leading.appendChild(title);
  leading.appendChild(renderStatusBadge(state, connected));
  leading.appendChild(renderHeaderTelemetry(state));

  toolbar.appendChild(leading);
  const cluster = controls ?? el('div', 'board-header__controls');
  if (!cluster.classList.contains('board-header__controls')) {
    cluster.classList.add('board-header__controls');
  }
  toolbar.appendChild(cluster);
  header.appendChild(toolbar);

  const meta = renderHeaderMeta(state, connected);
  if (meta) header.appendChild(meta);

  return header;
}

function renderStatusBadge(state: BoardState, connected: boolean): HTMLElement {
  const { variant, label } = headerStatus(state, connected);
  const badge = el('span', `board-header__badge board-header__badge--${variant}`);
  badge.setAttribute('role', 'status');
  const dot = el('span', 'board-header__badge-dot');
  dot.setAttribute('aria-hidden', 'true');
  badge.appendChild(dot);
  badge.appendChild(el('span', 'board-header__badge-label', label));
  return badge;
}

function headerStatus(
  state: BoardState,
  connected: boolean,
): { variant: string; label: string } {
  if (!connected && state.status === 'running') {
    return { variant: 'stalled', label: 'Reconnecting' };
  }
  if (state.stopReason === 'terminal' || state.finalTest?.outcome === 'fail') {
    return { variant: 'failed', label: 'Failed' };
  }
  if (state.finished || state.stopReason === 'complete') {
    return { variant: 'complete', label: 'Complete' };
  }
  if (state.status === 'running') return { variant: 'running', label: 'Running' };
  if (state.status === 'stopped') return { variant: 'stopped', label: 'Stopped' };
  return { variant: 'ready', label: 'Ready' };
}

function renderHeaderTelemetry(state: BoardState): HTMLElement {
  const telemetry = el('div', 'board-header__telemetry');
  const metricsRow = el('div', 'board-header__metrics');
  metricsRow.setAttribute('role', 'group');
  metricsRow.setAttribute('aria-label', 'Board metrics');

  const total = state.tasks.size;
  const done =
    countPhase(state, 'merged') +
    countPhase(state, 'abandoned') +
    countPhase(state, 'skipped');
  const active =
    countPhase(state, 'building') +
    countPhase(state, 'testing') +
    countPhase(state, 'merging');
  const totalWaves = Math.max(state.waves.length, groupByWave(state).length);
  const wavesComplete = countWavesComplete(state);

  const tokens: Array<{ value: string; label: string; key: string }> = [
    { value: `${done}/${total}`, label: 'tasks', key: 'tasks' },
    { value: `${wavesComplete}/${totalWaves}`, label: 'waves', key: 'waves' },
    { value: `${active}/${state.concurrency}`, label: 'run', key: 'running' },
  ];
  tokens.forEach((token, index) => {
    if (index > 0) {
      const sep = el('span', 'board-header__metric-sep', '·');
      sep.setAttribute('aria-hidden', 'true');
      metricsRow.appendChild(sep);
    }
    const node = el('span', 'board-header__metric');
    node.dataset.boardMetric = token.key;
    node.appendChild(el('span', 'board-header__metric-value', token.value));
    node.appendChild(el('span', 'board-header__metric-label', token.label));
    metricsRow.appendChild(node);
  });
  telemetry.appendChild(metricsRow);

  const bar = el('div', 'board-header__progress');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  bar.setAttribute('aria-valuenow', String(pct));
  bar.setAttribute('aria-label', `${done} of ${total} tasks complete`);
  const fill = el('div', 'board-header__progress-fill');
  fill.style.setProperty('--progress-scale', String(pct / 100));
  bar.appendChild(fill);
  telemetry.appendChild(bar);
  return telemetry;
}

function renderHeaderMeta(state: BoardState, connected: boolean): HTMLElement | null {
  const bits: string[] = [];
  if (state.status === 'stopped' && state.stopReason) {
    bits.push(`stopped: ${state.stopReason}`);
  }
  if (state.integrationSha) {
    bits.push(state.integrationSha.slice(0, 8));
  }
  if (!connected && state.status !== 'running') {
    bits.push('reconnecting');
  }
  if (bits.length === 0) return null;
  const meta = el('div', 'board-header__meta');
  meta.appendChild(el('p', 'board-header__meta-note', bits.join(' · ')));
  return meta;
}

function countWavesComplete(state: BoardState): number {
  let n = 0;
  for (const [, ids] of groupByWave(state)) {
    if (ids.length === 0) continue;
    const allDone = ids.every((id) => {
      const task = state.tasks.get(id);
      return (
        task != null &&
        (task.phase === 'merged' || task.phase === 'abandoned' || task.phase === 'skipped')
      );
    });
    if (allDone) n += 1;
  }
  return n;
}

export function countPhase(state: BoardState, phase: TaskState['phase']): number {
  let n = 0;
  for (const task of state.tasks.values()) if (task.phase === phase) n += 1;
  return n;
}


export function renderEngineErrors(
  errors: ReadonlyMap<string, EngineError> | undefined,
): HTMLElement | null {
  if (!errors || errors.size === 0) return null;
  const wrap = el('section', 'ov2-errors');
  wrap.setAttribute('role', 'alert');
  wrap.setAttribute('aria-live', 'assertive');
  wrap.appendChild(el('h3', 'ov2-errors__title', 'Work is not starting'));

  const list = el('ul', 'ov2-errors__list');
  for (const error of errors.values()) {
    const item = el('li', 'ov2-errors__item');
    const what = error.taskId ? `${error.role} for ${error.taskId}` : error.role;
    item.appendChild(el('span', 'ov2-errors__what', what));
    item.appendChild(el('span', 'ov2-errors__message', error.message));
    if (error.consecutive > 1) {
      item.appendChild(
        el('span', 'ov2-errors__count', `${error.consecutive} ticks in a row`),
      );
    }
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

// ── Task list ────────────────────────────────────────────────────────────────

export function renderTaskList(
  state: BoardState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const list = el('div', 'ov2-tasks');
  if (state.tasks.size === 0) {
    list.appendChild(renderEmptyBoard(state));
    return list;
  }

  for (const [wave, ids] of groupByWave(state)) {
    const section = el('section', 'ov2-wave ob-sec');
    const name = state.waves.find((w) => w.n === wave)?.name;
    const heading = el('h3', 'ov2-wave__title', name ? `Wave ${wave} — ${name}` : `Wave ${wave}`);
    const headingId = `ov2-wave-${wave}`;
    heading.id = headingId;
    section.appendChild(heading);

    const buckets = bucketWave(state, ids);
    const grid = el('div', 'ov2-kanban');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-labelledby', headingId);
    grid.dataset.wave = String(wave);

    for (const column of COLUMNS) {
      const tasks = buckets.get(column.id) ?? [];
      grid.appendChild(renderColumn(state, column.id, column.label, tasks, actions, options));
    }
    section.appendChild(grid);
    list.appendChild(section);
  }

  attachKeyboardGrid(list);
  return list;
}

function renderEmptyBoard(state: BoardState): HTMLElement {
  const wrap = el('div', 'ov2-blank');
  wrap.appendChild(el('p', 'ov2-blank__title', 'This board has no tasks.'));
  wrap.appendChild(
    el(
      'p',
      'ov2-blank__body',
      `${state.planPath} parsed, but declared no tasks. Add \`#### Task\` sections to the plan ` +
        'and create the board again — a board is a snapshot of the plan it was made from.',
    ),
  );
  return wrap;
}

function renderColumn(
  state: BoardState,
  id: ColumnId,
  label: string,
  tasks: readonly TaskState[],
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const column = el('div', `ov2-col ov2-col--${id}`);
  column.dataset.column = id;

  const head = el('div', 'ov2-col__head');
  head.appendChild(el('span', 'ov2-col__label', label));
  head.appendChild(el('span', 'ov2-col__count', String(tasks.length)));
  column.appendChild(head);

  const body = el('div', 'ov2-col__body');
  if (tasks.length === 0) {
    body.appendChild(el('p', 'ov2-col__empty', '—'));
  }
  for (const task of tasks) body.appendChild(renderTaskCard(state, task, actions, options));
  column.appendChild(body);
  return column;
}

function renderTaskCard(
  state: BoardState,
  task: TaskState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const card = el('article', 'ov2-task');
  card.dataset.taskId = task.id;
  card.classList.add(`ov2-task--${task.phase}`);
  const selected = options.selectedTaskId === task.id;
  if (selected) card.classList.add('is-selected');
  const blocked = isBlocked(state, task);
  if (blocked) card.classList.add('ov2-task--blocked');

  const head = el('button', 'ov2-task__head');
  head.type = 'button';
  head.dataset.taskId = task.id;
  head.tabIndex = selected ? 0 : -1;
  head.setAttribute('aria-pressed', selected ? 'true' : 'false');
  head.setAttribute(
    'aria-label',
    `${task.id} ${task.title}, ${phaseLabel(state, task)}`,
  );
  head.dataset.focusKey = `task:${task.id}`;
  head.addEventListener('click', () => {
    if (!selected) actions.select(task.id);
  });

  head.appendChild(el('span', 'ov2-task__id', task.id));
  head.appendChild(el('span', 'ov2-task__title', task.title));
  const badges = el('span', 'ov2-task__badges');
  badges.appendChild(pill(phaseLabel(state, task), blocked ? 'warn' : PHASE_TONE[task.phase]));
  if (task.outcome) badges.appendChild(pill(task.outcome, OUTCOME_TONE[task.outcome] ?? 'neutral'));
  const tries = task.attempts.filter((a) => a.ended).length;
  if (tries > 0) {
    badges.appendChild(el('span', 'ov2-task__tries', `${tries} ${tries === 1 ? 'try' : 'tries'}`));
  }
  head.appendChild(badges);
  card.appendChild(head);

  if (blocked) {
    const waiting = task.dependsOn.filter((dep) => state.tasks.get(dep)?.phase !== 'merged');
    card.appendChild(el('p', 'ov2-task__blocked', `waiting on ${waiting.join(', ')}`));
  }

  const live = options.liveHeadlines?.get(task.id);
  if (live && (task.phase === 'building' || task.phase === 'testing')) {
    const liveLine = el('p', 'ov2-task__live', `${live.role}: ${live.text}`);
    liveLine.setAttribute('aria-live', 'polite');
    card.appendChild(liveLine);
  }

  const failure =
    options.engineErrors?.get(`builder:${task.id}`) ??
    options.engineErrors?.get(`tester:${task.id}`);
  if (failure) {
    const note = el('p', 'ov2-task__failed', failure.message);
    note.setAttribute('role', 'status');
    card.appendChild(note);
  }

  card.appendChild(renderCardControls(state, task, actions, options));
  return card;
}

function renderCardControls(
  state: BoardState,
  task: TaskState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const controls = el('div', 'ov2-task__controls');
  const startable = isStartable(state, task);
  const pending = options.pendingTaskIds.has(task.id);

  const start = el('button', 'ov2-btn ov2-btn--ghost', pending ? 'Starting…' : startLabel(task, startable));
  start.type = 'button';
  start.tabIndex = -1;
  start.disabled = pending || !startable.can;
  start.dataset.focusKey = `start:${task.id}`;
  start.title = startable.can
    ? startable.mode === 'rerun'
      ? `Rerun ${task.id} after this failed run`
      : `Start ${task.id} now, outside the concurrency cap`
    : startable.why;
  start.addEventListener('click', () => {
    if (startable.can && startable.mode === 'rerun') actions.rerun([task.id]);
    else actions.startTask(task.id);
  });
  controls.appendChild(start);

  const terminal =
    task.phase === 'merged' || task.phase === 'abandoned' || task.phase === 'skipped';
  const abandon = el('button', 'ov2-btn ov2-btn--ghost', 'Abandon');
  abandon.type = 'button';
  abandon.tabIndex = -1;
  abandon.disabled = terminal;
  abandon.dataset.focusKey = `abandon:${task.id}`;
  abandon.title = terminal
    ? 'This task has already finished'
    : `Give up on ${task.id}. Journaled, so anything depending on it is stranded too.`;
  abandon.addEventListener('click', () => actions.abandonTask(task.id));
  controls.appendChild(abandon);

  return controls;
}

function startLabel(
  task: TaskState,
  startable: { can: boolean; mode?: 'start' | 'rerun' },
): string {
  if (startable.mode === 'rerun') return 'Retry';
  return task.attempts.some((a) => a.ended) ? 'Retry' : 'Start';
}

export function isStartable(
  state: BoardState,
  task: TaskState,
): { can: true; mode: 'start' | 'rerun'; why: string } | { can: false; why: string } {
  if (task.phase === 'merged') return { can: false, why: 'already merged' };
  if (task.attempts.some((a) => !a.ended)) return { can: false, why: 'already running' };
  if (task.phase === 'abandoned' || task.phase === 'skipped') {
    return { can: true, mode: 'rerun', why: '' };
  }
  if (state.finished) return { can: true, mode: 'rerun', why: '' };
  const blocking = task.dependsOn.filter((dep) => state.tasks.get(dep)?.phase !== 'merged');
  if (blocking.length > 0) {
    return { can: false, why: `waiting on ${blocking.join(', ')}` };
  }
  return { can: true, mode: 'start', why: '' };
}


function attachKeyboardGrid(list: HTMLElement): void {
  list.addEventListener('keydown', (event: KeyboardEvent) => {
    const key = event.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
      return;
    }
    const current = (event.target as HTMLElement | null)?.closest<HTMLElement>('.ov2-task__head');
    if (!current) return;
    const grid = current.closest<HTMLElement>('.ov2-kanban');
    if (!grid) return;

    const columns = [...grid.querySelectorAll<HTMLElement>('.ov2-col')];
    const column = current.closest<HTMLElement>('.ov2-col');
    if (!column) return;
    const columnIndex = columns.indexOf(column);
    const heads = [...column.querySelectorAll<HTMLElement>('.ov2-task__head')];
    const rowIndex = heads.indexOf(current);

    const focusIn = (index: number, row: number): boolean => {
      const target = columns[index];
      if (!target) return false;
      const candidates = [...target.querySelectorAll<HTMLElement>('.ov2-task__head')];
      if (candidates.length === 0) return false;
      const pick = candidates[Math.min(row, candidates.length - 1)];
      pick?.focus();
      return true;
    };

    let handled = false;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const next = heads[rowIndex + (key === 'ArrowUp' ? -1 : 1)];
      if (next) {
        next.focus();
        handled = true;
      }
    } else {
      const step = key === 'ArrowLeft' ? -1 : 1;
      for (let i = columnIndex + step; i >= 0 && i < columns.length; i += step) {
        if (focusIn(i, rowIndex)) {
          handled = true;
          break;
        }
      }
    }
    if (handled) event.preventDefault();
  });
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export function renderRunLedger(
  state: BoardState,
  actions?: Pick<BoardActions, 'rerun'>,
): HTMLElement | null {
  if (!state.finished && !state.runSummary && !state.finalTest) return null;

  const wrap = el('section', 'ov2-report ob-sec');
  wrap.appendChild(el('h3', 'ov2-report__title', 'What the journal says'));

  if (state.runSummary) {
    wrap.appendChild(el('p', 'ov2-report__summary', state.runSummary));
  }

  const stats = el('div', 'ov2-report__stats');
  stats.appendChild(field('Merged', String(countPhase(state, 'merged'))));
  stats.appendChild(field('Abandoned', String(countPhase(state, 'abandoned'))));
  stats.appendChild(field('Skipped', String(countPhase(state, 'skipped'))));
  stats.appendChild(field('Attempts', String(totalAttempts(state))));
  if (state.integrationSha) {
    stats.appendChild(field('Integration', state.integrationSha.slice(0, 12)));
  }
  wrap.appendChild(stats);

  if (state.finalTest) {
    wrap.appendChild(renderFinalTest(state, actions));
  }

  const table = el('ul', 'ov2-report__tasks');
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    const row = el('li', `ov2-report__task ov2-report__task--${task.phase}`);
    row.appendChild(el('span', 'ov2-report__task-id', task.id));
    row.appendChild(el('span', 'ov2-report__task-title', task.title));
    row.appendChild(pill(task.phase, PHASE_TONE[task.phase]));
    const tries = task.attempts.filter((a) => a.ended).length;
    row.appendChild(
      el('span', 'ov2-report__task-tries', `${tries} ${tries === 1 ? 'attempt' : 'attempts'}`),
    );
    const why = reasonFor(task);
    if (why) row.appendChild(el('span', 'ov2-report__task-why', why));
    table.appendChild(row);
  }
  wrap.appendChild(table);
  return wrap;
}

function renderFinalTest(
  state: BoardState,
  actions?: Pick<BoardActions, 'rerun'>,
): HTMLElement {
  const final = el('div', 'ov2-report__final');
  const test = state.finalTest!;
  final.appendChild(
    pill(`final test ${test.outcome}`, test.outcome === 'pass' ? 'good' : 'bad'),
  );
  if (test.runInstructions) {
    final.appendChild(el('span', 'ov2-report__run-label', 'Run it yourself:'));
    final.appendChild(el('code', 'ov2-report__run', test.runInstructions));
  }
  if (test.outcome === 'fail') {
    const evidence = test.evidence && typeof test.evidence === 'object' ? test.evidence : {};
    const failedRung =
      typeof evidence.failedRung === 'string' && evidence.failedRung.trim()
        ? evidence.failedRung.trim()
        : '';
    const output = typeof evidence.output === 'string' ? evidence.output : '';
    if (failedRung) {
      final.appendChild(el('p', 'ov2-report__rung', `Failed rung: ${failedRung}`));
    }
    if (output.trim()) {
      const pre = el('pre', 'ov2-report__ladder-out');
      pre.textContent = output.length > 8000 ? `${output.slice(0, 7986)}\n…[truncated]` : output;
      final.appendChild(pre);
    }
    if (actions?.rerun) {
      const n = reopenTargets(state).length;
      const retry = el(
        'button',
        'ov2-btn ov2-btn--primary ov2-report__retry',
        n > 0
          ? `Rerun ${n} failed task${n === 1 ? '' : 's'}`
          : 'Add a fix task and re-verify',
      );
      retry.type = 'button';
      retry.addEventListener('click', () => actions.rerun());
      final.appendChild(retry);
    }
  }
  return final;
}

function totalAttempts(state: BoardState): number {
  let n = 0;
  for (const task of state.tasks.values()) n += task.attempts.filter((a) => a.ended).length;
  return n;
}

function reasonFor(task: TaskState): string {
  if (task.abandonedReason) {
    return task.abandonedReason === 'user'
      ? 'abandoned by hand'
      : `abandoned: ${task.abandonedReason}`;
  }
  if (task.skippedBy) return `stranded by ${task.skippedBy}`;
  if (task.mergeConflicts && task.mergeConflicts.length > 0) {
    return `conflicted on ${task.mergeConflicts.join(', ')}`;
  }
  const last = [...task.attempts].reverse().find((a) => a.ended);
  if (last?.summary) return last.summary;
  return '';
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export function renderSkeleton(rows = 6, className = 'ov2-skeleton'): HTMLElement {
  const wrap = el('div', className);
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < rows; i += 1) {
    const line = el('div', 'ov2-skeleton__line');
    line.style.width = `${55 + ((i * 37) % 40)}%`;
    wrap.appendChild(line);
  }
  return wrap;
}

export function renderBoardSkeleton(): HTMLElement {
  const wrap = el('div', 'ov2-loading');
  const status = el('p', 'ov2-sr-only', 'Loading the board');
  status.setAttribute('role', 'status');
  wrap.appendChild(status);
  wrap.appendChild(renderSkeleton(3, 'ov2-skeleton ov2-skeleton--head'));
  wrap.appendChild(renderSkeleton(6));
  return wrap;
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export function renderMergeQueue(state: BoardState): HTMLElement {
  const wrap = el('section', 'ov2-queue ob-sec');
  wrap.appendChild(el('h3', 'ov2-queue__title', 'Merge queue'));
  if (state.mergeQueue.length === 0) {
    wrap.appendChild(empty('Empty.'));
    return wrap;
  }
  const list = el('ol', 'ov2-queue__list');
  state.mergeQueue.forEach((id, index) => {
    const item = el('li', 'ov2-queue__item');
    item.appendChild(el('span', 'ov2-queue__pos', String(index + 1)));
    item.appendChild(el('span', 'ov2-queue__id', id));
    if (index === 0) item.appendChild(pill('merging', 'live'));
    list.appendChild(item);
  });
  wrap.appendChild(list);
  return wrap;
}


export function renderTimeline(
  events: readonly Record<string, unknown>[],
  truncated: boolean,
): HTMLElement {
  const wrap = el('div', 'ov2-timeline');
  if (truncated) {
    wrap.appendChild(
      el('p', 'ov2-timeline__note', 'Showing the most recent entries. The journal is kept in full.'),
    );
  }
  if (events.length === 0) {
    wrap.appendChild(empty('Nothing on the journal yet.'));
    return wrap;
  }
  const list = el('ol', 'ov2-timeline__list');
  for (const event of events) {
    const item = el('li', 'ov2-timeline__item');
    item.appendChild(el('span', 'ov2-timeline__seq', String(event.seq ?? '')));
    item.appendChild(el('span', 'ov2-timeline__type', String(event.type ?? 'unknown')));
    item.appendChild(el('span', 'ov2-timeline__detail', summariseEvent(event)));
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}


export function renderFinishReport(markdown: string | null, loading: boolean): HTMLElement {
  const wrap = el('section', 'ov2-finish');
  wrap.appendChild(el('h3', 'ov2-finish__title', 'Run report'));
  if (loading && !markdown) {
    wrap.appendChild(el('p', 'ov2-finish__pending', 'Writing the end-of-run report…'));
    return wrap;
  }
  if (!markdown) {
    wrap.appendChild(empty('No report yet.'));
    return wrap;
  }
  const body = el('pre', 'ov2-finish__body');
  body.textContent = markdown;
  wrap.appendChild(body);
  return wrap;
}

function summariseEvent(event: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ['taskId', 'role', 'outcome', 'reason', 'blockedBy', 'concurrency', 'sha', 'name']) {
    const value = event[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${String(value)}`);
  }
  if (typeof event.summary === 'string' && event.summary) parts.push(event.summary);
  return parts.join('  ');
}
