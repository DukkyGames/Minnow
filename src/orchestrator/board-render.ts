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
 */

import type {
  Attempt,
  BoardState,
  TaskState,
} from '../../server/orchestrator/core/types';
import { el, empty, field, pill } from './dom';

/** What the surface can ask the engine to do, passed in rather than imported. */
export interface BoardActions {
  startTask: (taskId: string) => void;
  /** null when no task is selected. */
  select: (taskId: string | null) => void;
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
function phaseLabel(task: TaskState): string {
  if (task.phase === 'idle' && task.attempts.length > 0) return 'waiting';
  return task.phase;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * The board's status strip.
 *
 * `connected` is separate from `status` on purpose: a board can be running while
 * this window is not receiving its events, and a view that conflated the two
 * would show a stalled board as a stopped one.
 */
export function renderBoardHeader(state: BoardState, connected: boolean): HTMLElement {
  const header = el('header', 'ov2-board__header');

  const title = el('div', 'ov2-board__title');
  title.appendChild(el('h2', 'ov2-board__name', state.name || state.boardId));
  title.appendChild(el('span', 'ov2-board__plan', state.planPath));
  header.appendChild(title);

  const strip = el('div', 'ov2-board__status');
  strip.appendChild(
    pill(
      state.finished ? 'finished' : state.status,
      state.finished ? 'good' : state.status === 'running' ? 'live' : 'neutral',
    ),
  );
  if (state.status === 'stopped' && state.stopReason) {
    strip.appendChild(el('span', 'ov2-board__reason', `stopped: ${state.stopReason}`));
  }
  strip.appendChild(field('Concurrency', String(state.concurrency)));
  strip.appendChild(field('Tasks', String(state.tasks.size)));
  strip.appendChild(field('Merged', String(countPhase(state, 'merged'))));
  if (state.integrationSha) {
    strip.appendChild(field('Integration', state.integrationSha.slice(0, 8)));
  }
  strip.appendChild(
    pill(connected ? 'live' : 'reconnecting…', connected ? 'live' : 'warn'),
  );
  header.appendChild(strip);

  if (state.runSummary) {
    header.appendChild(el('p', 'ov2-board__summary', state.runSummary));
  }
  if (state.finalTest) {
    const final = el('div', 'ov2-board__final');
    final.appendChild(
      pill(`final test ${state.finalTest.outcome}`, state.finalTest.outcome === 'pass' ? 'good' : 'bad'),
    );
    if (state.finalTest.runInstructions) {
      final.appendChild(el('code', 'ov2-board__final-run', state.finalTest.runInstructions));
    }
    header.appendChild(final);
  }

  return header;
}

function countPhase(state: BoardState, phase: TaskState['phase']): number {
  let n = 0;
  for (const task of state.tasks.values()) if (task.phase === phase) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** Tasks grouped by declared wave, in the order the plan declared them. */
export function renderTaskList(
  state: BoardState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const list = el('div', 'ov2-tasks');
  if (state.tasks.size === 0) {
    list.appendChild(empty('This board has no tasks.'));
    return list;
  }

  for (const [wave, ids] of groupByWave(state)) {
    const section = el('section', 'ov2-wave');
    const name = state.waves.find((w) => w.n === wave)?.name;
    section.appendChild(
      el('h3', 'ov2-wave__title', name ? `Wave ${wave} — ${name}` : `Wave ${wave}`),
    );
    for (const id of ids) {
      const task = state.tasks.get(id);
      if (task) section.appendChild(renderTaskRow(state, task, actions, options));
    }
    list.appendChild(section);
  }
  return list;
}

function groupByWave(state: BoardState): Array<[number, string[]]> {
  const waves = new Map<number, string[]>();
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    const bucket = waves.get(task.wave) ?? [];
    bucket.push(id);
    waves.set(task.wave, bucket);
  }
  return [...waves.entries()].sort((a, b) => a[0] - b[0]);
}

function renderTaskRow(
  state: BoardState,
  task: TaskState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const row = el('article', 'ov2-task');
  row.dataset.taskId = task.id;
  row.classList.add(`ov2-task--${task.phase}`);
  const selected = options.selectedTaskId === task.id;
  if (selected) row.classList.add('is-selected');

  const head = el('button', 'ov2-task__head');
  head.type = 'button';
  head.setAttribute('aria-expanded', selected ? 'true' : 'false');
  head.addEventListener('click', () => actions.select(selected ? null : task.id));

  head.appendChild(el('span', 'ov2-task__id', task.id));
  head.appendChild(el('span', 'ov2-task__title', task.title));
  head.appendChild(pill(phaseLabel(task), PHASE_TONE[task.phase]));
  if (task.outcome) head.appendChild(pill(task.outcome, OUTCOME_TONE[task.outcome] ?? 'neutral'));
  const tries = task.attempts.filter((a) => a.ended).length;
  if (tries > 0) {
    head.appendChild(el('span', 'ov2-task__tries', `${tries} ${tries === 1 ? 'try' : 'tries'}`));
  }
  row.appendChild(head);

  const live = options.liveHeadlines?.get(task.id);
  if (live && (task.phase === 'building' || task.phase === 'testing')) {
    // Status still comes from derive(); this line is the live hook so a
    // running attempt shows the current tool without journaling tokens.
    const liveLine = el('p', 'ov2-task__live', `${live.role}: ${live.text}`);
    liveLine.setAttribute('aria-live', 'polite');
    row.appendChild(liveLine);
  }

  const controls = el('div', 'ov2-task__controls');
  const startable = isStartable(state, task);
  const pending = options.pendingTaskIds.has(task.id);
  const start = el('button', 'ov2-btn ov2-btn--ghost', pending ? 'Starting…' : 'Start');
  start.type = 'button';
  start.disabled = pending || !startable.can;
  start.title = startable.can ? `Start ${task.id} now, outside the concurrency cap` : startable.why;
  start.addEventListener('click', () => actions.startTask(task.id));
  controls.appendChild(start);
  row.appendChild(controls);

  if (selected) row.appendChild(renderTaskDetail(state, task));
  return row;
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

function renderTaskDetail(state: BoardState, task: TaskState): HTMLElement {
  const detail = el('div', 'ov2-task__detail');

  const meta = el('div', 'ov2-task__meta');
  meta.appendChild(field('Touches', task.touches.join(', ') || '—'));
  meta.appendChild(
    field('Depends on', task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'nothing'),
  );
  if (task.mergedSha) meta.appendChild(field('Merged', task.mergedSha.slice(0, 12)));
  detail.appendChild(meta);

  for (const [label, value] of [
    ['Build', task.buildSpec],
    ['Test', task.testSpec],
    ['Accept', task.accept],
  ] as const) {
    if (!value) continue;
    const spec = el('div', 'ov2-task__spec');
    spec.appendChild(el('span', 'ov2-task__spec-label', label));
    spec.appendChild(el('p', 'ov2-task__spec-text', value));
    detail.appendChild(spec);
  }

  if (task.abandonedReason) {
    const reason = el('div', 'ov2-task__note ov2-task__note--bad');
    reason.appendChild(el('strong', undefined, 'Abandoned'));
    reason.appendChild(el('span', undefined, task.abandonedReason));
    detail.appendChild(reason);
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
    detail.appendChild(reason);
  }
  if (task.mergeConflicts && task.mergeConflicts.length > 0) {
    const conflict = el('div', 'ov2-task__note ov2-task__note--warn');
    conflict.appendChild(el('strong', undefined, 'Merge conflict'));
    conflict.appendChild(el('span', undefined, task.mergeConflicts.join(', ')));
    detail.appendChild(conflict);
  }
  for (const overflow of task.touchesOverflow) {
    const note = el('div', 'ov2-task__note ov2-task__note--info');
    note.appendChild(el('strong', undefined, 'Wrote outside its footprint'));
    note.appendChild(el('span', undefined, overflow.actual.join(', ')));
    detail.appendChild(note);
  }
  if (task.emptyTouchesGlobs && task.emptyTouchesGlobs.length > 0) {
    const note = el('div', 'ov2-task__note ov2-task__note--warn');
    note.appendChild(el('strong', undefined, 'Glob matched no files'));
    note.appendChild(el('span', undefined, task.emptyTouchesGlobs.join(', ')));
    detail.appendChild(note);
  }

  detail.appendChild(renderAttempts(task.attempts));
  return detail;
}

function renderAttempts(attempts: readonly Attempt[]): HTMLElement {
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
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

// ---------------------------------------------------------------------------
// Merge queue
// ---------------------------------------------------------------------------

export function renderMergeQueue(state: BoardState): HTMLElement {
  const wrap = el('section', 'ov2-queue');
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
  for (const key of ['taskId', 'role', 'outcome', 'reason', 'blockedBy', 'concurrency', 'sha']) {
    const value = event[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${String(value)}`);
  }
  if (typeof event.summary === 'string' && event.summary) parts.push(event.summary);
  return parts.join('  ');
}
