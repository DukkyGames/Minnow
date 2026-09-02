import type { Attempt, BoardState, TaskState } from '../../server/orchestrator/core/types';
import { COLUMNS, columnOf, type ColumnId } from './board-columns';
import {
  OUTCOME_TONE,
  PHASE_TONE,
  isStartable,
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

const ui = {
  expandedRows: new Set<string>(),
  expandedSummaries: new Set<string>(),
  followLog: true,
  logScrollTop: 0,
  specOpen: null as boolean | null,
};

// ── Reset ────────────────────────────────────────────────────────────────────

export function resetTaskDetailLogUi(): void {
  ui.expandedRows.clear();
  ui.followLog = true;
  ui.logScrollTop = 0;
}

export function resetTaskDetailUi(): void {
  resetTaskDetailLogUi();
  ui.expandedSummaries.clear();
  ui.specOpen = null;
}

// ── Detail ───────────────────────────────────────────────────────────────────

export function renderTaskDetail(
  state: BoardState,
  task: TaskState,
  actions: BoardActions,
  options: BoardViewOptions,
): HTMLElement {
  const titleId = `ov2-detail-title-${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const overlay = el('div', 'ov2-detail-overlay');
  overlay.dataset.focusKey = 'detail-overlay';
  overlay.addEventListener('click', () => actions.select(null));

  const detail = el('section', 'ov2-detail');
  detail.setAttribute('role', 'dialog');
  detail.setAttribute('aria-modal', 'true');
  detail.setAttribute('aria-labelledby', titleId);
  detail.addEventListener('click', (event) => event.stopPropagation());

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

// ── Head ─────────────────────────────────────────────────────────────────────

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

  const startable = isStartable(state, task);
  if (startable.can) {
    const retry = el(
      'button',
      startable.mode === 'rerun' ? 'ov2-btn ov2-btn--primary' : 'ov2-btn ov2-btn--ghost',
      startable.mode === 'rerun' || task.attempts.some((a) => a.ended) ? 'Retry' : 'Start',
    );
    retry.type = 'button';
    retry.title = startable.mode === 'rerun' ? `Rerun ${task.id}` : `Start ${task.id} now`;
    retry.addEventListener('click', () => {
      if (startable.mode === 'rerun') actions.rerun([task.id]);
      else actions.startTask(task.id);
    });
    head.appendChild(retry);
  }

  head.appendChild(renderFacts(state, task));
  return head;
}

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
    add('warn', 'Skipped', `${task.skippedBy} failed, so this never ran. It did not fail itself.`);
  }
  if (task.mergeConflicts && task.mergeConflicts.length > 0) {
    add('warn', 'Merge conflict', task.mergeConflicts.join(', '), true);
  }
  for (const overflow of task.touchesOverflow) {
    add('info', 'Wrote outside its footprint', overflow.actual.join(', '), true);
  }
  if (task.emptyTouchesGlobs && task.emptyTouchesGlobs.length > 0) {
    add(
      'info',
      'Did not exist yet',
      `${task.emptyTouchesGlobs.join(', ')} matched nothing when the board was made.`,
    );
  }
  return alerts;
}


function section(label: string, meta?: HTMLElement | null): HTMLElement {
  const wrap = el('section', 'ov2-panel');
  const head = el('div', 'ov2-panel__head');
  head.appendChild(el('h3', 'ov2-panel__title', label));
  if (meta) head.appendChild(meta);
  wrap.appendChild(head);
  return wrap;
}

function statsLine(files: number, additions: number, deletions: number): HTMLElement {
  const meta = el('div', 'ov2-panel__meta');
  meta.appendChild(el('span', 'ov2-panel__count', `${files} file${files === 1 ? '' : 's'}`));
  meta.appendChild(el('span', 'ov2-panel__sep', '·'));
  meta.appendChild(el('span', 'ov2-stat ov2-stat--add', `+${additions}`));
  meta.appendChild(el('span', 'ov2-stat ov2-stat--del', `−${deletions}`));
  return meta;
}

// ── Files ────────────────────────────────────────────────────────────────────

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

function renderPlannedRow(path: string, actions: BoardActions): HTMLElement {
  const row = el('div', 'ov2-file ov2-file--planned');
  const header = el('div', 'ov2-file__header');
  header.appendChild(el('span', 'ov2-file__toggle-spacer'));
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


const ROLE_ICON = {
  builder: 'boardBuild',
  tester: 'boardTest',
  merge: 'boardGroup',
} as const;

// ── Attempts ─────────────────────────────────────────────────────────────────

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


const LOG_LABEL: Record<string, string> = {
  thinking: 'Thought',
  tool_call: 'Tool',
  tool_result: 'Result',
  round_end: 'Round',
  attempt_end: 'Ended',
  error: 'Error',
};

interface LogRow {
  kind: 'thought' | 'tool' | 'result' | 'end' | 'error' | 'plain';
  label: string;
  lead: string;
  trail?: string;
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

// ── Log ──────────────────────────────────────────────────────────────────────

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
  if (type === 'round_end') {
    const index = typeof event.index === 'number' ? event.index : null;
    const tools = typeof event.toolCallCount === 'number' ? event.toolCallCount : 0;
    const text = asText(event.text);
    return {
      kind: 'plain',
      label,
      lead: index == null ? 'round' : `round ${index}`,
      trail: tools > 0 ? `${tools} tool${tools === 1 ? '' : 's'}` : text ? firstLine(text) : undefined,
      full: text || undefined,
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

  scroller.addEventListener('scroll', () => {
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    ui.followLog = distance <= 24;
    ui.logScrollTop = scroller.scrollTop;
  });
  wrap.appendChild(scroller);

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

// ── Spec ─────────────────────────────────────────────────────────────────────

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
