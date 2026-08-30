/**
 * Rendering a `BoardState` into DOM. Nothing here reads or writes anything else.
 *
 * The split matters: these functions take a state and a set of callbacks and
 * return elements. They hold no state of their own, so what is on screen is a
 * function of what the journal says — which is the same property the engine has,
 * and the reason a stale view cannot become a wrong one.
 *
 * V1's board rendering read from a store the renderer itself wrote to. Here
 * there is no store, and no way to make one: the only input is the argument.
 *
 * ## Phase 9
 *
 * The task list is waves × kanban columns (P9-B) rather than a flat list, the
 * detail panel can read an attempt's transcript (P9-D), a finished run gets a
 * report instead of one paragraph (P9-G), and failures that stop work from
 * starting have somewhere to appear (P9-A). None of that changes the rule above:
 * a card's column is `columnOf()` over the fold, and the only writes on this
 * page are the callbacks in {@link BoardActions}, each of which is a POST.
 */

import type {
  Attempt,
  BoardState,
  TaskState,
} from '../../server/orchestrator/core/types';
import type { EngineError } from './client';
import {
  bucketWave,
  COLUMNS,
  columnOf,
  groupByWave,
  isBlocked,
  type ColumnId,
} from './board-columns';
import { el, empty, field, pill } from './dom';

/** What the surface can ask the engine to do, passed in rather than imported. */
export interface BoardActions {
  startTask: (taskId: string) => void;
  /** P9-H — journals `task.abandoned { reason: 'user' }`. Never a local write. */
  abandonTask: (taskId: string) => void;
  /** null when no task is selected. */
  select: (taskId: string | null) => void;
  /** Load one attempt's transcript into the detail panel. */
  openTranscript: (attemptId: string) => void;
}

/** A transcript being shown in the detail panel — P9-D. */
export interface TranscriptView {
  attemptId: string;
  status: 'loading' | 'ready' | 'error';
  events: readonly Record<string, unknown>[];
  truncated: boolean;
  capped: boolean;
  error?: string;
}

export interface BoardViewOptions {
  selectedTaskId: string | null;
  /** Tasks whose manual start is in flight, so the button can say so. */
  pendingTaskIds: ReadonlySet<string>;
  /**
   * Live agent output from SSE `event: live` (P2-F bus, P2-G render).
   * Presentation-only — never folded into `BoardState`.
   */
  liveHeadlines?: ReadonlyMap<string, { role: string; text: string }>;
  /** Work failing to start, from SSE `event: error` (P9-A). Also never folded. */
  engineErrors?: ReadonlyMap<string, EngineError>;
  /** The transcript open in the detail panel, if any. */
  transcript?: TranscriptView | null;
}

const PHASE_TONE: Record<TaskState['phase'], 'neutral' | 'live' | 'good' | 'warn' | 'bad'> = {
  idle: 'neutral',
  building: 'live',
  testing: 'live',
  merging: 'live',
  merged: 'good',
  abandoned: 'bad',
  skipped: 'warn',
};

const OUTCOME_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad'> = {
  pass: 'good',
  fail: 'bad',
  blocked: 'warn',
  no_report: 'warn',
  crashed: 'bad',
  timeout: 'bad',
  conflicted: 'warn',
};

/** Human wording for a phase. The state's vocabulary, not a second one. */
function phaseLabel(state: BoardState, task: TaskState): string {
  if (task.phase === 'idle' && isBlocked(state, task)) return 'blocked';
  if (task.phase === 'idle' && task.attempts.length > 0) return 'waiting';
  return task.phase;
}

// ---------------------------------------------------------------------------
// Runhead — V1 `.board-header` instrument strip (restated under `.ov2`)
// ---------------------------------------------------------------------------

/**
 * The board's status strip. Markup matches the Orchestrator `.board-header`
 * (title, badge, telemetry, then run controls) so Boards is the same instrument
 * rather than a second chrome vocabulary. `ob-runhead` stays for the twin-shape
 * name; the rules live under `.ov2` so Phase 4 can delete V1 CSS.
 *
 * `connected` is separate from `status` on purpose: a board can be running while
 * this window is not receiving its events, and a view that conflated the two
 * would show a stalled board as a stopped one.
 *
 * `controls` is the interactive cluster (model, concurrency, Start/Stop). It is
 * passed in so this file stays a pure function of state: the POSTs live in the
 * view, not here.
 */
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

/** Status chip: Ready / Running / Stopped / Complete / Failed / Reconnecting. */
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
  // A live run whose stream dropped is stalled, not stopped: Stop would be a lie.
  if (!connected && state.status === 'running') {
    return { variant: 'stalled', label: 'Reconnecting' };
  }
  if (state.finished || state.stopReason === 'complete') {
    return { variant: 'complete', label: 'Complete' };
  }
  if (state.status === 'running') return { variant: 'running', label: 'Running' };
  if (state.status === 'stopped' && state.stopReason === 'terminal') {
    return { variant: 'failed', label: 'Failed' };
  }
  if (state.status === 'stopped') return { variant: 'stopped', label: 'Stopped' };
  return { variant: 'ready', label: 'Ready' };
}

/**
 * Inline telemetry: done/total tasks, waves, in-flight vs N, thin progress.
 * Elapsed is omitted: V2's fold has no wall-clock start, and inventing one
 * in the renderer would be a second clock.
 */
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

/** Secondary band: only alerts (stop reason, integration sha). */
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

function countPhase(state: BoardState, phase: TaskState['phase']): number {
  let n = 0;
  for (const task of state.tasks.values()) if (task.phase === phase) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Engine errors — P9-A
// ---------------------------------------------------------------------------

/**
 * Failures that stopped work from starting.
 *
 * One block, not one toast per tick: these repeat every tick for as long as the
 * precondition is broken, and `consecutive` is what turns forty identical
 * failures into a sentence rather than forty notifications.
 *
 * Returns null when there is nothing to say, so the caller can skip the node
 * rather than paint an empty container.
 */
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

// ---------------------------------------------------------------------------
// Tasks — waves × columns (P9-B)
// ---------------------------------------------------------------------------

/**
 * The board: one kanban grid per declared wave.
 *
 * Waves are the outer grouping because a wave is the unit the plan declares and
 * the unit dependencies respect; columns are the inner grouping because what a
 * task is *doing* is the thing anyone watching a run is actually asking.
 */
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

/**
 * The empty state — P9-I.
 *
 * A board with no tasks is a plan that parsed and declared none, which is worth
 * saying plainly rather than showing a blank grid.
 */
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
    // Kept, not collapsed: a lane that vanishes when it empties makes the board
    // jump under the pointer, and an empty Testing column is information.
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
  // Roving tabindex: the grid is one tab stop, arrows move within it (P9-I).
  head.tabIndex = selected ? 0 : -1;
  head.setAttribute('aria-pressed', selected ? 'true' : 'false');
  head.setAttribute(
    'aria-label',
    `${task.id} ${task.title}, ${phaseLabel(state, task)}`,
  );
  // Survives a repaint: the surface rebuilds from scratch on every frame, so
  // focus is restored by key rather than by node identity (P9-I).
  head.dataset.focusKey = `task:${task.id}`;
  // Open (or replace) the detail overlay. Same-card click does not toggle closed —
  // dismiss is Close, scrim, or Escape (see renderTaskDetail).
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
    // Status still comes from derive(); this line is the live hook so a
    // running attempt shows the current tool without journaling tokens.
    const liveLine = el('p', 'ov2-task__live', `${live.role}: ${live.text}`);
    liveLine.setAttribute('aria-live', 'polite');
    card.appendChild(liveLine);
  }

  const failure =
    options.engineErrors?.get(`builder:${task.id}`) ??
    options.engineErrors?.get(`tester:${task.id}`);
  if (failure) {
    // P9-A on the card itself, not only in the banner: the banner says the board
    // is stuck, this says which card is stuck and why.
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

  const start = el('button', 'ov2-btn ov2-btn--ghost', pending ? 'Starting…' : startLabel(task));
  start.type = 'button';
  start.tabIndex = -1;
  start.disabled = pending || !startable.can;
  start.dataset.focusKey = `start:${task.id}`;
  start.title = startable.can
    ? `Start ${task.id} now, outside the concurrency cap`
    : startable.why;
  start.addEventListener('click', () => actions.startTask(task.id));
  controls.appendChild(start);

  // P9-H. A journaled command, not a local write — see `engine.abandonTask`.
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

/**
 * "Start" or "Retry" — the same command either way.
 *
 * V1 had a separate retry path with its own counters. Here retrying *is*
 * starting: `nextAction()` reads the journal and picks the seed, so a task that
 * has failed twice gets the repair seed and the button does not have to know.
 */
function startLabel(task: TaskState): string {
  return task.attempts.some((a) => a.ended) ? 'Retry' : 'Start';
}

/**
 * Whether a manual start would be accepted, and why not when it would not.
 *
 * This mirrors `manualStart()` rather than guessing: a disabled button that
 * disagrees with the server is worse than no button. The server still decides —
 * a 409 comes back as a message — this only saves the round trip and explains
 * the reason in place.
 */
function isStartable(state: BoardState, task: TaskState): { can: boolean; why: string } {
  if (state.finished) return { can: false, why: 'the run has finished' };
  if (task.phase === 'merged') return { can: false, why: 'already merged' };
  if (task.phase === 'abandoned') return { can: false, why: 'abandoned' };
  if (task.phase === 'skipped') return { can: false, why: 'waiting on something that failed' };
  if (task.attempts.some((a) => !a.ended)) return { can: false, why: 'already running' };
  const blocking = task.dependsOn.filter((dep) => state.tasks.get(dep)?.phase !== 'merged');
  if (blocking.length > 0) {
    return { can: false, why: `waiting on ${blocking.join(', ')}` };
  }
  return { can: true, why: '' };
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

/**
 * Arrow-key navigation across the grid — P9-I.
 *
 * Ported from `orchestrate-board-keyboard.ts` **as navigation only**. V1's
 * Ctrl/Cmd+Arrow moved a card between lanes, which was a status write; a card's
 * column here is derived, so there is nothing for that gesture to mean.
 *
 * Left/right cross columns, up/down move within one. Delegated from the list so
 * a repaint does not have to re-bind anything.
 */
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

    /** @returns the first focusable head at or after `row` in a column */
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
      // Skip empty columns rather than dead-ending on one.
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

// ---------------------------------------------------------------------------
// Task detail
// ---------------------------------------------------------------------------

/**
 * The selected task, in full — as a centered overlay over the board.
 *
 * Specs and notes are the reason you open a card; meta stays a compact strip
 * under the title. A growing in-grid card would reflow its column, and a
 * bottom dock pushes Finish / ledger off-screen for the same long content.
 */
export function renderTaskDetail(
  state: BoardState,
  task: TaskState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const titleId = `ov2-detail-title-${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  // Scrim owns dismiss-on-outside; the dialog stops propagation so clicks inside stay open.
  const overlay = el('div', 'ov2-detail-overlay');
  overlay.dataset.focusKey = 'detail-overlay';
  overlay.addEventListener('click', () => actions.select(null));

  const detail = el('section', 'ov2-detail ob-sec');
  detail.setAttribute('role', 'dialog');
  detail.setAttribute('aria-modal', 'true');
  detail.setAttribute('aria-labelledby', titleId);
  detail.addEventListener('click', (event) => event.stopPropagation());

  // Escape also bubbles from focus inside the dialog; boards-view adds a
  // document capture listener so dismiss still works if focus drifts.
  const dismissOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    actions.select(null);
  };
  overlay.addEventListener('keydown', dismissOnEscape);
  detail.addEventListener('keydown', dismissOnEscape);

  const head = el('div', 'ov2-detail__head');
  const title = el('h3', 'ov2-detail__title');
  title.id = titleId;
  title.appendChild(el('span', 'ov2-detail__id', task.id));
  title.appendChild(el('span', undefined, task.title));
  head.appendChild(title);
  head.appendChild(pill(phaseLabel(state, task), PHASE_TONE[task.phase]));
  const close = el('button', 'ov2-btn ov2-btn--ghost', 'Close');
  close.type = 'button';
  close.dataset.focusKey = 'detail-close';
  close.addEventListener('click', () => actions.select(null));
  head.appendChild(close);
  detail.appendChild(head);

  // Compact instrument strip — status facts, not the reading surface.
  const meta = el('div', 'ov2-detail__meta ov2-task__meta');
  meta.appendChild(field('Column', columnLabel(columnOf(state, task))));
  meta.appendChild(field('Wave', String(task.wave)));
  meta.appendChild(field('Touches', task.touches.join(', ') || '—'));
  meta.appendChild(
    field('Depends on', task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'nothing'),
  );
  if (task.mergedSha) meta.appendChild(field('Merged', task.mergedSha.slice(0, 12)));
  detail.appendChild(meta);

  const body = el('div', 'ov2-detail__body');

  for (const [label, value] of [
    ['Build', task.buildSpec],
    ['Test', task.testSpec],
    ['Accept', task.accept],
  ] as const) {
    if (!value) continue;
    const spec = el('div', 'ov2-task__spec');
    spec.appendChild(el('span', 'ov2-task__spec-label', label));
    // Preserve newlines from plan specs; white-space is handled in CSS.
    spec.appendChild(el('p', 'ov2-task__spec-text', value));
    body.appendChild(spec);
  }

  if (task.abandonedReason) {
    const reason = el('div', 'ov2-task__note ov2-task__note--bad');
    reason.appendChild(el('strong', undefined, 'Abandoned'));
    reason.appendChild(
      el(
        'span',
        undefined,
        task.abandonedReason === 'user' ? 'by hand' : task.abandonedReason,
      ),
    );
    body.appendChild(reason);
  }
  if (task.skippedBy) {
    // Skipped is not a failure of this task — it is waiting on something that failed.
    const reason = el('div', 'ov2-task__note ov2-task__note--warn');
    reason.appendChild(el('strong', undefined, 'Skipped'));
    reason.appendChild(
      el(
        'span',
        undefined,
        `waiting on ${task.skippedBy}, which failed — this task did not fail`,
      ),
    );
    body.appendChild(reason);
  }
  if (task.mergeConflicts && task.mergeConflicts.length > 0) {
    const conflict = el('div', 'ov2-task__note ov2-task__note--warn');
    conflict.appendChild(el('strong', undefined, 'Merge conflict'));
    conflict.appendChild(el('span', undefined, task.mergeConflicts.join(', ')));
    body.appendChild(conflict);
  }
  for (const overflow of task.touchesOverflow) {
    const note = el('div', 'ov2-task__note ov2-task__note--info');
    note.appendChild(el('strong', undefined, 'Wrote outside its footprint'));
    note.appendChild(el('span', undefined, overflow.actual.join(', ')));
    body.appendChild(note);
  }
  if (task.emptyTouchesGlobs && task.emptyTouchesGlobs.length > 0) {
    const note = el('div', 'ov2-task__note ov2-task__note--warn');
    note.appendChild(el('strong', undefined, 'Glob matched no files'));
    note.appendChild(el('span', undefined, task.emptyTouchesGlobs.join(', ')));
    body.appendChild(note);
  }

  body.appendChild(renderAttempts(task.attempts, actions, options));
  if (options.transcript) body.appendChild(renderTranscript(options.transcript));

  detail.appendChild(body);
  overlay.appendChild(detail);
  return overlay;
}

function columnLabel(id: ColumnId): string {
  return COLUMNS.find((c) => c.id === id)?.label ?? id;
}

function renderAttempts(
  attempts: readonly Attempt[],
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const wrap = el('div', 'ov2-attempts');
  wrap.appendChild(el('h4', 'ov2-attempts__title', 'Attempts'));
  if (attempts.length === 0) {
    wrap.appendChild(empty('Nothing has been tried yet.'));
    return wrap;
  }
  const list = el('ol', 'ov2-attempts__list');
  for (const attempt of attempts) {
    const item = el('li', 'ov2-attempt');
    item.appendChild(el('span', 'ov2-attempt__role', attempt.role));
    if (attempt.seedKind) item.appendChild(el('span', 'ov2-attempt__seed', attempt.seedKind));
    if (attempt.manual && !attempt.ended) item.appendChild(pill('by hand', 'neutral'));
    item.appendChild(
      attempt.ended
        ? pill(attempt.outcome ?? 'ended', OUTCOME_TONE[attempt.outcome ?? ''] ?? 'neutral')
        : pill('running', 'live'),
    );
    if (attempt.summary) item.appendChild(el('span', 'ov2-attempt__summary', attempt.summary));

    // P9-D. Merge attempts are synthesised by the fold and never ran an agent,
    // so there is nothing to read for them.
    if (attempt.role === 'builder' || attempt.role === 'tester') {
      const open = el(
        'button',
        'ov2-btn ov2-btn--ghost ov2-attempt__open',
        options.transcript?.attemptId === attempt.attemptId ? 'Hide log' : 'Read log',
      );
      open.type = 'button';
      open.dataset.focusKey = `transcript:${attempt.attemptId}`;
      open.addEventListener('click', () => actions.openTranscript(attempt.attemptId));
      item.appendChild(open);
    }
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

/**
 * One attempt's transcript — P9-D.
 *
 * Read-only, and that is the whole design. V1's equivalent was a board-owned
 * chat you could talk into (`orchestrate-board-chat.ts`); the half that was
 * load-bearing was reading what happened, and the half that made the renderer
 * an engine was writing into it.
 */
function renderTranscript(view: TranscriptView): HTMLElement {
  const wrap = el('div', 'ov2-transcript');
  wrap.appendChild(el('h4', 'ov2-transcript__title', `Log — ${view.attemptId}`));

  if (view.status === 'loading') {
    wrap.appendChild(renderSkeleton(4, 'ov2-transcript__skeleton'));
    return wrap;
  }
  if (view.status === 'error') {
    wrap.appendChild(
      el('p', 'ov2-notice ov2-notice--warn', view.error ?? 'Could not read the transcript.'),
    );
    return wrap;
  }
  if (view.events.length === 0) {
    wrap.appendChild(
      empty('Nothing was recorded for this attempt. Transcripts start at the first tool call.'),
    );
    return wrap;
  }
  if (view.truncated || view.capped) {
    wrap.appendChild(
      el(
        'p',
        'ov2-timeline__note',
        view.capped
          ? 'This attempt produced more than the transcript keeps; the rest was dropped.'
          : 'Showing the most recent entries.',
      ),
    );
  }

  const list = el('ol', 'ov2-transcript__list');
  for (const event of view.events) {
    const item = el('li', 'ov2-transcript__item');
    item.appendChild(el('span', 'ov2-transcript__type', String(event.type ?? '')));
    const name = event.name ?? event.summary ?? event.text ?? event.error ?? '';
    item.appendChild(el('span', 'ov2-transcript__name', String(name)));
    const body = event.arguments ?? event.result;
    if (body !== undefined) {
      item.appendChild(
        el(
          'span',
          'ov2-transcript__body',
          typeof body === 'string' ? body : JSON.stringify(body),
        ),
      );
    }
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

// ---------------------------------------------------------------------------
// Finish report — P9-G
// ---------------------------------------------------------------------------

/**
 * The per-task ledger, derived — the other half of P3-G's report.
 *
 * `renderFinishReport` below shows the persisted narrative artifact, which an
 * LLM wrote. This shows what the *journal* says: every task's outcome, how many
 * attempts it took, why anything was abandoned, the integration sha, and the
 * Final Tester's run instructions.
 *
 * Kept separate and rendered beneath it on purpose. The narrative can be late,
 * absent, or wrong; the ledger is a fold over the record and is none of those,
 * so the question "what actually happened" always has an answer on screen even
 * when the report writer never ran.
 */
export function renderRunLedger(state: BoardState): HTMLElement | null {
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
    const final = el('div', 'ov2-report__final');
    final.appendChild(
      pill(
        `final test ${state.finalTest.outcome}`,
        state.finalTest.outcome === 'pass' ? 'good' : 'bad',
      ),
    );
    if (state.finalTest.runInstructions) {
      final.appendChild(el('span', 'ov2-report__run-label', 'Run it yourself:'));
      final.appendChild(el('code', 'ov2-report__run', state.finalTest.runInstructions));
    }
    wrap.appendChild(final);
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

function totalAttempts(state: BoardState): number {
  let n = 0;
  for (const task of state.tasks.values()) n += task.attempts.filter((a) => a.ended).length;
  return n;
}

/** Why a task ended the way it did, in one phrase, or '' when it just worked. */
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

// ---------------------------------------------------------------------------
// Loading — P9-I
// ---------------------------------------------------------------------------

/**
 * A skeleton, not the word "Loading".
 *
 * The board's shape is known before its content is, so showing that shape is
 * both faster to read and stops the layout jumping when the first frame lands.
 */
export function renderSkeleton(rows = 6, className = 'ov2-skeleton'): HTMLElement {
  const wrap = el('div', className);
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < rows; i += 1) {
    const line = el('div', 'ov2-skeleton__line');
    // Uneven widths read as content; equal bars read as a progress meter.
    line.style.width = `${55 + ((i * 37) % 40)}%`;
    wrap.appendChild(line);
  }
  return wrap;
}

/** The loading state for the whole board pane, announced for screen readers. */
export function renderBoardSkeleton(): HTMLElement {
  const wrap = el('div', 'ov2-loading');
  const status = el('p', 'ov2-sr-only', 'Loading the board');
  status.setAttribute('role', 'status');
  wrap.appendChild(status);
  wrap.appendChild(renderSkeleton(3, 'ov2-skeleton ov2-skeleton--head'));
  wrap.appendChild(renderSkeleton(6));
  return wrap;
}

// ---------------------------------------------------------------------------
// Merge queue
// ---------------------------------------------------------------------------

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
    // Rule 5: the queue is serialised, so only the head is ever in flight.
    if (index === 0) item.appendChild(pill('merging', 'live'));
    list.appendChild(item);
  });
  wrap.appendChild(list);
  return wrap;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * The journal, as it is. Not a narrative — the raw record, because when a run
 * goes wrong the question is always "what actually happened", and any summary
 * here would be a second interpretation of events.
 */
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

// ---------------------------------------------------------------------------
// Finish report (P3-G)
// ---------------------------------------------------------------------------

/**
 * The one report a set-and-forget run delivers. Data comes from the persisted
 * artifact, not from BoardState, so this view cannot feed the engine.
 *
 * Markdown is shown as preformatted text: the writer is an LLM, and this
 * surface must not interpret that string as HTML.
 */
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
