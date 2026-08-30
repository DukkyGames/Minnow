/**
 * The selected task, in full.
 *
 * ## What this is for
 *
 * You open a card because it stopped being green. So the panel answers, in
 * order: what state is this in, what did it change, what was tried, and only
 * then what the plan asked for. The spec used to come first and took the whole
 * first screen; it is the thing you already know when a task fails.
 *
 * Three reading surfaces, each with the same shape as its neighbour elsewhere
 * in the app rather than a private one:
 *
 * - **Files** is the chat code-change list (`src/ui/code-change-strip.ts`): a
 *   chevron that opens the unified diff in place, a path that opens the editor,
 *   and `+N −N` in mono. Same affordance, same markup vocabulary, one thing to
 *   learn. Numbers come from git at `mergedSha`, never from the journal.
 * - **Attempts** is the run: one row per try, its outcome, its one-line summary,
 *   and its log underneath when you open it.
 * - **Spec** is markdown through the same renderer chat uses, collapsed once the
 *   task has run, so a fenced `package.json` reads as code instead of as forty
 *   lines of pre-wrap.
 *
 * ## The state rule still holds
 *
 * Nothing here writes board state. Files and transcripts are reads, and the only
 * mutations reachable from this panel are the callbacks in `BoardActions`. The
 * module-level `ui` object below holds *view* state only (which rows are open,
 * where the log is scrolled), because the surface calls `replaceChildren` on
 * every engine event and an expanded row would otherwise collapse under the
 * reader several times a minute.
 */

import type { Attempt, BoardState, TaskState } from '../../server/orchestrator/core/types';
import { COLUMNS, columnOf, type ColumnId } from './board-columns';
import {
  OUTCOME_TONE,
  PHASE_TONE,
  phaseLabel,
  renderSkeleton,
  type BoardActions,
  type BoardViewOptions,
  type FileDiffView,
  type TaskFilesView,
  type TranscriptView,
} from './board-render';
import type { TaskFileStat } from './client';
import { el, empty, pill } from './dom';
import { createIcon } from '../ui/icon';
import { renderUnifiedPromptDiff } from '../ui/prompt-diff-unified';
import { setAssistantBubbleContent } from '../markdown/renderer';

/**
 * View state that has to survive a repaint.
 *
 * Not board state and never journaled: which disclosure is open and where a log
 * is scrolled are facts about this window, not about the run.
 */
const ui = {
  /** Log rows the reader expanded to full text, keyed `<attemptId>:<index>`. */
  expandedRows: new Set<string>(),
  /** Attempt summaries the reader opened out past their clamp. */
  expandedSummaries: new Set<string>(),
  /** Whether the log is pinned to its tail. Set false when the reader scrolls up. */
  followLog: true,
  /** Last log scroll offset, so a repaint does not throw the reader to the top. */
  logScrollTop: 0,
  /** Whether the spec disclosure is open, once the reader has said either way. */
  specOpen: null as boolean | null,
};

/** Forget the open log's row and scroll state. Called when a different log opens. */
export function resetTaskDetailLogUi(): void {
  ui.expandedRows.clear();
  ui.followLog = true;
  ui.logScrollTop = 0;
}

/** Forget everything this panel remembers. Called when the selected task changes. */
export function resetTaskDetailUi(): void {
  resetTaskDetailLogUi();
  ui.expandedSummaries.clear();
  ui.specOpen = null;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

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

  const detail = el('section', 'ov2-detail');
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

  detail.appendChild(renderHead(state, task, actions, titleId));

  const body = el('div', 'ov2-detail__body');
  for (const alert of renderAlerts(task)) body.appendChild(alert);
  body.appendChild(renderFilesSection(task, actions, options));
  body.appendChild(renderAttemptsSection(task, actions, options));
  const spec = renderSpecSection(task);
  if (spec) body.appendChild(spec);
  detail.appendChild(body);

  overlay.appendChild(detail);
  return overlay;
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

function renderHead(
  state: BoardState,
  task: TaskState,
  actions: BoardActions,
  titleId: string,
): HTMLElement {
  const head = el('header', 'ov2-detail__head');

  const top = el('div', 'ov2-detail__top');
  const ident = el('div', 'ov2-detail__ident');
  ident.appendChild(el('span', 'ov2-detail__id', task.id));
  const title = el('h2', 'ov2-detail__title', task.title);
  title.id = titleId;
  ident.appendChild(title);
  top.appendChild(ident);

  const phase = phaseLabel(state, task);
  top.appendChild(pill(phase, PHASE_TONE[task.phase]));

  const close = el('button', 'ov2-detail__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.title = 'Close (Esc)';
  close.dataset.focusKey = 'detail-close';
  close.appendChild(createIcon('close', { size: 16 }));
  close.addEventListener('click', () => actions.select(null));
  top.appendChild(close);
  head.appendChild(top);

  head.appendChild(renderFacts(state, task));
  return head;
}

/** One quiet line of status facts. Not a form, and not the reading surface. */
function renderFacts(state: BoardState, task: TaskState): HTMLElement {
  const facts = el('dl', 'ov2-facts');
  const add = (label: string, value: string, mono = false) => {
    facts.appendChild(el('dt', 'ov2-facts__label', label));
    facts.appendChild(el('dd', mono ? 'ov2-facts__value ov2-facts__value--mono' : 'ov2-facts__value', value));
  };
  add('Column', columnLabel(columnOf(state, task)));
  add('Wave', String(task.wave));
  add('Needs', task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'nothing');
  if (task.mergedSha) add('Merged', task.mergedSha.slice(0, 10), true);
  return facts;
}

function columnLabel(id: ColumnId): string {
  return COLUMNS.find((c) => c.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * Why the card is not green, directly under the title.
 *
 * These used to sit below the spec, which meant the one thing worth reading was
 * a scroll away from the reason you opened the panel.
 */
function renderAlerts(task: TaskState): HTMLElement[] {
  const alerts: HTMLElement[] = [];
  const add = (
    tone: 'bad' | 'warn' | 'info',
    heading: string,
    detail: string,
    mono = false,
  ) => {
    const alert = el('div', `ov2-alert ov2-alert--${tone}`);
    alert.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
    alert.appendChild(el('span', 'ov2-alert__heading', heading));
    alert.appendChild(el('span', mono ? 'ov2-alert__detail ov2-alert__detail--mono' : 'ov2-alert__detail', detail));
    alerts.push(alert);
  };

  if (task.abandonedReason) {
    add(
      'bad',
      'Abandoned',
      task.abandonedReason === 'user' ? 'Stopped by hand.' : task.abandonedReason,
    );
  }
  if (task.skippedBy) {
    // Skipped is not this task failing. It is waiting on one that did.
    add('warn', 'Skipped', `${task.skippedBy} failed, so this never ran. It did not fail itself.`);
  }
  if (task.mergeConflicts && task.mergeConflicts.length > 0) {
    add('warn', 'Merge conflict', task.mergeConflicts.join(', '), true);
  }
  for (const overflow of task.touchesOverflow) {
    add('info', 'Wrote outside its footprint', overflow.actual.join(', '), true);
  }
  if (task.emptyTouchesGlobs && task.emptyTouchesGlobs.length > 0) {
    // Informational, not a warning. The expansion is frozen at `board.created`,
    // so a task whose whole job is to *create* these files always lands here,
    // and colouring it amber next to a green diffstat says the opposite of what
    // happened.
    add(
      'info',
      'Did not exist yet',
      `${task.emptyTouchesGlobs.join(', ')} matched nothing when the board was made.`,
    );
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function section(label: string, meta?: HTMLElement | null): HTMLElement {
  const wrap = el('section', 'ov2-panel');
  const head = el('div', 'ov2-panel__head');
  head.appendChild(el('h3', 'ov2-panel__title', label));
  if (meta) head.appendChild(meta);
  wrap.appendChild(head);
  return wrap;
}

/** `3 files · +455 −0`, the same shape and order the composer strip uses. */
function statsLine(files: number, additions: number, deletions: number): HTMLElement {
  const meta = el('div', 'ov2-panel__meta');
  meta.appendChild(el('span', 'ov2-panel__count', `${files} file${files === 1 ? '' : 's'}`));
  meta.appendChild(el('span', 'ov2-panel__sep', '·'));
  meta.appendChild(el('span', 'ov2-stat ov2-stat--add', `+${additions}`));
  meta.appendChild(el('span', 'ov2-stat ov2-stat--del', `−${deletions}`));
  return meta;
}

function renderFilesSection(
  task: TaskState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const view = options.files?.taskId === task.id ? options.files : null;
  const merged = view?.status === 'ready' && view.source === 'merged' && view.files.length > 0;

  const wrap = section(
    'Files',
    merged ? statsLine(view.files.length, view.additions, view.deletions) : null,
  );

  if (view?.status === 'loading') {
    wrap.appendChild(renderSkeleton(3, 'ov2-skeleton ov2-skeleton--files'));
    return wrap;
  }

  if (merged) {
    const list = el('div', 'ov2-files');
    for (const file of view.files) list.appendChild(renderFileRow(file, view, actions));
    wrap.appendChild(list);
    if (view.truncated) {
      wrap.appendChild(
        el('p', 'ov2-panel__note', 'Only the first 400 files are listed.'),
      );
    }
    return wrap;
  }

  // Not merged, or git could not answer. The declared footprint is the honest
  // answer: it says what the task is allowed to touch, not what it touched.
  const planned = task.touchesExpanded?.length ? task.touchesExpanded : task.touches;
  if (planned.length === 0) {
    wrap.appendChild(empty('This task declared no file footprint.'));
    return wrap;
  }
  const list = el('div', 'ov2-files ov2-files--planned');
  for (const path of planned) list.appendChild(renderPlannedRow(path, actions));
  wrap.appendChild(list);
  wrap.appendChild(
    el(
      'p',
      'ov2-panel__note',
      task.mergedSha
        ? 'Line counts need the merge commit, and git could not read it.'
        : 'Its declared footprint. Line counts arrive when the task merges.',
    ),
  );
  return wrap;
}

/** Directory quiet, filename legible, and the filename never truncates. */
function pathLabel(path: string): HTMLElement {
  const wrap = el('span', 'ov2-file__path');
  const cut = path.lastIndexOf('/');
  if (cut >= 0) wrap.appendChild(el('span', 'ov2-file__dir', path.slice(0, cut + 1)));
  wrap.appendChild(el('span', 'ov2-file__name', cut >= 0 ? path.slice(cut + 1) : path));
  return wrap;
}

function renderFileRow(
  file: TaskFileStat,
  view: TaskFilesView,
  actions: BoardActions,
): HTMLElement {
  const row = el('div', 'ov2-file');
  const header = el('div', 'ov2-file__header');
  const open = view.expanded.has(file.path);

  const toggle = el('button', 'ov2-file__toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} diff for ${file.path}`);
  toggle.dataset.focusKey = `file-toggle:${file.path}`;
  toggle.classList.toggle('is-open', open);
  toggle.appendChild(createIcon('chevronRight', { size: 12 }));
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.toggleFileDiff(file.path);
  });
  header.appendChild(toggle);

  const openFile = el('button', 'ov2-file__open');
  openFile.type = 'button';
  openFile.title = file.path;
  openFile.setAttribute('aria-label', `Open ${file.path}`);
  openFile.dataset.focusKey = `file-open:${file.path}`;
  openFile.appendChild(pathLabel(file.path));
  openFile.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.openFile(file.path);
  });
  header.appendChild(openFile);

  const stats = el('span', 'ov2-file__stats');
  if (file.binary) {
    stats.appendChild(el('span', 'ov2-file__binary', 'binary'));
  } else {
    if (file.additions > 0) {
      stats.appendChild(el('span', 'ov2-stat ov2-stat--add', `+${file.additions}`));
    }
    if (file.deletions > 0) {
      stats.appendChild(el('span', 'ov2-stat ov2-stat--del', `−${file.deletions}`));
    }
  }
  header.appendChild(stats);
  row.appendChild(header);

  if (open) row.appendChild(renderFileDiff(view.diffs.get(file.path)));
  return row;
}

function renderFileDiff(diff: FileDiffView | undefined): HTMLElement {
  const host = el('div', 'ov2-file__diff');
  if (!diff || diff.status === 'loading') {
    host.appendChild(renderSkeleton(3, 'ov2-skeleton ov2-skeleton--diff'));
    return host;
  }
  if (diff.status === 'error') {
    host.appendChild(el('p', 'ov2-panel__note', diff.error ?? 'Could not read this diff.'));
    return host;
  }
  if (diff.lines.length === 0) {
    host.appendChild(el('p', 'ov2-panel__note', 'No textual diff for this file.'));
    return host;
  }
  const body = el('div', 'ov2-file__diff-body');
  renderUnifiedPromptDiff(body, [...diff.lines]);
  host.appendChild(body);
  if (diff.truncated) {
    host.appendChild(el('p', 'ov2-panel__note', 'Diff shortened for display.'));
  }
  return host;
}

/** A declared path. No counts, because there is nothing yet to count. */
function renderPlannedRow(path: string, actions: BoardActions): HTMLElement {
  const row = el('div', 'ov2-file ov2-file--planned');
  const header = el('div', 'ov2-file__header');
  header.appendChild(el('span', 'ov2-file__toggle-spacer'));
  // A glob has no file to open; a concrete path does.
  if (/[*?[\]]/.test(path)) {
    const label = el('span', 'ov2-file__open ov2-file__open--static');
    label.title = path;
    label.appendChild(pathLabel(path));
    header.appendChild(label);
  } else {
    const openFile = el('button', 'ov2-file__open');
    openFile.type = 'button';
    openFile.title = path;
    openFile.setAttribute('aria-label', `Open ${path}`);
    openFile.dataset.focusKey = `file-open:${path}`;
    openFile.appendChild(pathLabel(path));
    openFile.addEventListener('click', () => actions.openFile(path));
    header.appendChild(openFile);
  }
  row.appendChild(header);
  return row;
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

const ROLE_ICON = {
  builder: 'boardBuild',
  tester: 'boardTest',
  merge: 'boardGroup',
} as const;

function renderAttemptsSection(
  task: TaskState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const wrap = section('Attempts');
  if (task.attempts.length === 0) {
    wrap.appendChild(empty('Nothing has been tried yet.'));
    return wrap;
  }
  const list = el('ol', 'ov2-attempts');
  task.attempts.forEach((attempt, index) => {
    list.appendChild(renderAttempt(attempt, index + 1, actions, options));
  });
  wrap.appendChild(list);
  return wrap;
}

function renderAttempt(
  attempt: Attempt,
  index: number,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const item = el('li', 'ov2-attempt');
  // Merge attempts are synthesised by the fold and never ran an agent, so there
  // is nothing to read for them.
  const readable = attempt.role === 'builder' || attempt.role === 'tester';
  const open = readable && options.transcript?.attemptId === attempt.attemptId;
  item.classList.toggle('is-open', open);

  const header = readable ? el('button', 'ov2-attempt__header') : el('div', 'ov2-attempt__header');
  if (header instanceof HTMLButtonElement) {
    header.type = 'button';
    header.setAttribute('aria-expanded', open ? 'true' : 'false');
    header.dataset.focusKey = `transcript:${attempt.attemptId}`;
    header.addEventListener('click', () => actions.openTranscript(attempt.attemptId));
  } else {
    header.classList.add('ov2-attempt__header--static');
  }

  const marker = el('span', 'ov2-attempt__index', String(index));
  marker.setAttribute('aria-hidden', 'true');
  header.appendChild(marker);

  const icon = createIcon(ROLE_ICON[attempt.role as keyof typeof ROLE_ICON] ?? 'boardBuild', {
    size: 13,
    className: 'ov2-attempt__icon',
  });
  header.appendChild(icon);

  const name = el('span', 'ov2-attempt__role', attempt.role);
  header.appendChild(name);
  if (attempt.seedKind) {
    header.appendChild(el('span', 'ov2-attempt__seed', attempt.seedKind.replace(/-/g, ' ')));
  }
  if (attempt.manual && !attempt.ended) header.appendChild(pill('by hand', 'neutral'));
  header.appendChild(
    attempt.ended
      ? pill(attempt.outcome ?? 'ended', OUTCOME_TONE[attempt.outcome ?? ''] ?? 'neutral')
      : pill('running', 'live'),
  );

  if (readable) {
    const chevron = createIcon('chevronRight', { size: 12, className: 'ov2-attempt__chevron' });
    header.appendChild(chevron);
  }
  item.appendChild(header);

  // The summary is the answer to "what happened", so it reads without opening
  // anything. The log is for when the summary is not enough.
  //
  // Clamped, because agents write paragraphs: an unclamped run of four attempts
  // is eight hundred words between the file list and the log, which is the wall
  // this panel exists to not be. The first three lines are the answer.
  if (attempt.summary) {
    const key = `summary:${attempt.attemptId}`;
    const open = ui.expandedSummaries.has(key);
    const summary = el('p', 'ov2-attempt__summary', attempt.summary);
    if (open) summary.classList.add('is-expanded');
    item.appendChild(summary);
    if (attempt.summary.length > 200) {
      const more = el('button', 'ov2-attempt__more', open ? 'Show less' : 'Show all');
      more.type = 'button';
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.dataset.focusKey = key;
      more.addEventListener('click', () => {
        const next = !ui.expandedSummaries.has(key);
        if (next) ui.expandedSummaries.add(key);
        else ui.expandedSummaries.delete(key);
        summary.classList.toggle('is-expanded', next);
        more.setAttribute('aria-expanded', next ? 'true' : 'false');
        more.textContent = next ? 'Show less' : 'Show all';
      });
      item.appendChild(more);
    }
  }
  if (open && options.transcript) {
    item.appendChild(renderLog(options.transcript, !attempt.ended));
  }
  return item;
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/**
 * Gutter wording per event type.
 *
 * The raw `type` strings are the runner's vocabulary, not a reader's. `delta`
 * never reaches disk, and `thinking` is coalesced by the recorder, so this list
 * is short by construction.
 */
const LOG_LABEL: Record<string, string> = {
  thinking: 'Thought',
  tool_call: 'Tool',
  tool_result: 'Result',
  attempt_end: 'Ended',
  error: 'Error',
};

interface LogRow {
  kind: 'thought' | 'tool' | 'result' | 'end' | 'error' | 'plain';
  label: string;
  /** Shown collapsed. Mono for tools and results, prose for reasoning. */
  lead: string;
  /** Secondary text on the same row, muted. */
  trail?: string;
  /** Full text behind the disclosure, when there is more than the lead shows. */
  full?: string;
  tone?: 'good' | 'bad' | 'warn';
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** A tool call's arguments as one scannable line: the values, not the schema. */
function summariseArgs(value: unknown): string {
  if (value === undefined || value === null) return '';
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (!parsed || typeof parsed !== 'object') return asText(parsed);
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const text = typeof raw === 'string' ? raw : asText(raw);
    if (!text) continue;
    parts.push(text.length > 80 ? `${key}: ${text.slice(0, 80)}…` : `${key}: ${text}`);
    if (parts.length === 3) break;
  }
  return parts.join('  ');
}

function firstLine(text: string, max = 140): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function toLogRow(event: Record<string, unknown>): LogRow | null {
  const type = typeof event.type === 'string' ? event.type : '';
  const label = LOG_LABEL[type] ?? type.replace(/_/g, ' ');
  if (!label) return null;

  if (type === 'thinking') {
    const text = asText(event.text);
    if (!text.trim()) return null;
    return { kind: 'thought', label, lead: text };
  }
  if (type === 'tool_call') {
    return {
      kind: 'tool',
      label,
      lead: asText(event.name) || 'tool',
      trail: firstLine(summariseArgs(event.arguments)),
      full: asText(event.arguments) || undefined,
    };
  }
  if (type === 'tool_result') {
    const content = asText(event.content ?? event.result);
    return {
      kind: 'result',
      label,
      lead: asText(event.name) || 'result',
      trail: content ? firstLine(content) : 'no output',
      full: content || undefined,
    };
  }
  if (type === 'attempt_end') {
    const outcome = asText(event.name) || 'ended';
    return {
      kind: 'end',
      label,
      lead: outcome,
      trail: asText(event.summary) ? firstLine(asText(event.summary), 200) : undefined,
      full: asText(event.summary) || undefined,
      tone: outcome === 'pass' ? 'good' : outcome === 'blocked' ? 'warn' : 'bad',
    };
  }
  const text = asText(event.error ?? event.text ?? event.summary ?? event.name);
  if (!text.trim()) return null;
  return {
    kind: type === 'error' ? 'error' : 'plain',
    label,
    lead: text,
    tone: type === 'error' ? 'bad' : undefined,
  };
}

/**
 * One attempt's log.
 *
 * Reasoning renders as prose in the UI font and tool traffic renders in mono,
 * because they are different kinds of text and the old three-column mono grid
 * made every line look like the same line.
 */
function renderLog(view: TranscriptView, live: boolean): HTMLElement {
  const wrap = el('div', 'ov2-log');

  if (view.status === 'loading') {
    wrap.appendChild(renderSkeleton(4, 'ov2-skeleton ov2-skeleton--log'));
    return wrap;
  }
  if (view.status === 'error') {
    wrap.appendChild(el('p', 'ov2-panel__note', view.error ?? 'Could not read this log.'));
    return wrap;
  }

  const rows = view.events.map(toLogRow).filter((row): row is LogRow => row !== null);
  if (rows.length === 0) {
    wrap.appendChild(
      empty(
        live
          ? 'Nothing recorded yet. The log starts at the first thought or tool call.'
          : 'Nothing was recorded for this attempt.',
      ),
    );
    return wrap;
  }

  if (view.capped || view.truncated) {
    wrap.appendChild(
      el(
        'p',
        'ov2-panel__note',
        view.capped
          ? 'This attempt ran longer than the log keeps. The rest was dropped.'
          : 'Showing the most recent entries.',
      ),
    );
  }

  const scroller = el('div', 'ov2-log__scroller');
  scroller.dataset.logScroller = view.attemptId;
  if (live) {
    scroller.setAttribute('role', 'log');
    scroller.setAttribute('aria-live', 'polite');
  }
  const list = el('ol', 'ov2-log__list');
  rows.forEach((row, index) => list.appendChild(renderLogRow(row, view.attemptId, index)));
  scroller.appendChild(list);

  // Follow the tail while the reader is at the bottom, and stop the moment they
  // scroll away. `scroll` fires after the assignment below, so the flag is only
  // ever cleared by a real gesture.
  scroller.addEventListener('scroll', () => {
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    ui.followLog = distance <= 24;
    ui.logScrollTop = scroller.scrollTop;
  });
  wrap.appendChild(scroller);

  // The surface rebuilds this element on every engine event, so the offset is
  // reapplied here rather than kept by the DOM.
  //
  // Only a *live* log follows its tail. A finished attempt is a document, and
  // opening a document at its last line is the wrong end to start reading from.
  queueMicrotask(() => {
    if (!scroller.isConnected) return;
    scroller.scrollTop = live && ui.followLog ? scroller.scrollHeight : ui.logScrollTop;
  });

  if (live) {
    wrap.appendChild(el('p', 'ov2-log__tail', 'Still running. New entries land here as they happen.'));
  }
  return wrap;
}

function renderLogRow(row: LogRow, attemptId: string, index: number): HTMLElement {
  const item = el('li', `ov2-log__row ov2-log__row--${row.kind}`);
  if (row.tone) item.classList.add(`ov2-log__row--${row.tone}`);

  item.appendChild(el('span', 'ov2-log__label', row.label));

  const content = el('div', 'ov2-log__content');
  const key = `${attemptId}:${index}`;
  const expanded = ui.expandedRows.has(key);

  if (row.kind === 'thought') {
    const text = el('p', 'ov2-log__thought', row.lead);
    if (expanded) text.classList.add('is-expanded');
    content.appendChild(text);
    // Long reasoning is clamped rather than hidden: the first lines are usually
    // the plan, and the rest is why.
    if (row.lead.length > 220) {
      content.appendChild(
        expandToggle(key, expanded, ['Show all', 'Show less'], () => {
          text.classList.toggle('is-expanded');
        }),
      );
    }
  } else {
    const line = el('div', 'ov2-log__line');
    line.appendChild(el('span', 'ov2-log__lead', row.lead));
    if (row.trail) line.appendChild(el('span', 'ov2-log__trail', row.trail));
    content.appendChild(line);
    // Only offer to expand when there is materially more to see. `{"path":"."}`
    // behind a "Show" button next to `path: .` is a control that does nothing.
    const hasMore = Boolean(row.full && row.full.length > (row.trail?.length ?? 0) + 40);
    if (hasMore) {
      const body = el('pre', 'ov2-log__body', row.full);
      body.hidden = !expanded;
      content.appendChild(body);
      content.appendChild(
        expandToggle(key, expanded, ['Show', 'Hide'], () => {
          body.hidden = !body.hidden;
        }),
      );
    }
  }
  item.appendChild(content);
  return item;
}

/**
 * A disclosure that survives the next repaint.
 *
 * The open set is read when the row is built and written when it is clicked, so
 * a log the reader has opened up stays open while the attempt keeps streaming.
 */
function expandToggle(
  key: string,
  expanded: boolean,
  [closedLabel, openLabel]: readonly [string, string],
  apply: () => void,
): HTMLButtonElement {
  const toggle = el('button', 'ov2-log__more', expanded ? openLabel : closedLabel);
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  toggle.dataset.focusKey = `log-more:${key}`;
  toggle.addEventListener('click', () => {
    const next = !ui.expandedRows.has(key);
    if (next) ui.expandedRows.add(key);
    else ui.expandedRows.delete(key);
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    toggle.textContent = next ? openLabel : closedLabel;
    apply();
  });
  return toggle;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

/**
 * What the plan asked for, last and folded away once the task has run.
 *
 * Rendered through the same markdown pipeline as chat, which is the whole point:
 * a plan's build step is markdown, and as raw pre-wrap text its bullets, its
 * backticked constants and its fenced JSON all render as one undifferentiated
 * paragraph. That was most of what made this panel a wall.
 */
function renderSpecSection(task: TaskState): HTMLElement | null {
  const parts: Array<[string, string]> = [];
  for (const [label, value] of [
    ['Build', task.buildSpec],
    ['Test', task.testSpec],
    ['Accept', task.accept],
  ] as const) {
    if (value) parts.push([label, value]);
  }
  if (parts.length === 0) return null;

  const details = el('details', 'ov2-spec');
  // A task that has not run is a task whose spec you are here to read.
  details.open = ui.specOpen ?? task.attempts.length === 0;
  details.addEventListener('toggle', () => {
    ui.specOpen = details.open;
  });

  const summary = el('summary', 'ov2-spec__summary');
  summary.dataset.focusKey = 'spec-toggle';
  summary.appendChild(createIcon('chevronRight', { size: 12, className: 'ov2-spec__chevron' }));
  summary.appendChild(el('span', 'ov2-panel__title', 'Spec'));
  summary.appendChild(
    el('span', 'ov2-spec__hint', parts.map(([label]) => label.toLowerCase()).join(' · ')),
  );
  details.appendChild(summary);

  const body = el('div', 'ov2-spec__body');
  for (const [label, value] of parts) {
    const block = el('div', 'ov2-spec__block');
    block.appendChild(el('h4', 'ov2-spec__label', label));
    const prose = el('div', 'ov2-spec__prose');
    setAssistantBubbleContent(prose, value);
    block.appendChild(prose);
    body.appendChild(block);
  }
  details.appendChild(body);
  return details;
}
