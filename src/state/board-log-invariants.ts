/**
 * Pure board-log invariant checker for Orchestrate diagnostic timelines.
 *
 * Every `updateTask` that changes a task status is preceded by `logTaskStatus`
 * (or goes through `moveTaskStatus`, which calls `logTaskStatus`) — except
 * `quarantineTaskAndDependents`, which emits `task_quarantined` via
 * `logQuarantine` (fixed in B1). Reconstructed timelines are therefore sound
 * once quarantine rows are present.
 *
 * Phase-2 durable events make phase, ownership, and concurrency state
 * reconstructible. Older logs remain valid inputs, but their missing evidence
 * is reported explicitly instead of being interpreted as a successful audit.
 */

import type { BoardLogEvent, BoardTaskStatus } from '../types.ts';

/** Nudge cap mirrored from orchestrate-board-actions.ts `MISSING_REPORT_NUDGE_CAP`. */
const DEFAULT_NUDGE_CAP = 2;

const DEFAULT_CAPS = {
  build: 2,
  test: 3,
  fixer: 2,
  nudge: DEFAULT_NUDGE_CAP,
} as const;

const TERMINAL_STATUSES = new Set<BoardTaskStatus>([
  'complete',
  'failed',
  'blocked',
  'quarantined',
]);

const FORWARD_CHAIN: Partial<Record<BoardTaskStatus, BoardTaskStatus>> = {
  planned: 'in_progress',
  in_progress: 'testing',
  testing: 'merging',
  merging: 'complete',
};

const REOPEN_FROM = new Set<BoardTaskStatus>([
  'complete',
  'failed',
  'blocked',
  'quarantined',
  'in_progress',
  'testing',
  'merging',
]);

export type BoardLogInvariantId =
  | 'status-transitions'
  | 'verdict-after-start'
  | 'attempt-caps'
  | 'merge-integrity'
  | 'final-test-order'
  | 'wave-order'
  | 'dependency-order'
  | 'quarantine-cascade'
  | 'phase-pairing'
  | 'slot-balance'
  | 'hold-balance'
  | 'concurrency-cap'
  | 'lifecycle-owner'
  | 'terminal-effects'
  | 'afk-hands-off';

export interface BoardLogCheckOptions {
  tasks: Array<{ id: string; wave?: string; dependsOn?: string[] }>;
  waveOrder?: string[];
  caps?: { build?: number; test?: number; fixer?: number; nudge?: number };
  expectFinalTest?: boolean;
  requireTerminal?: boolean;
  /** Make missing durable Phase-2 evidence affect `ok`; default is legacy-compatible. */
  strictEvidence?: boolean;
  /** Explicit mode when the log starts after the mode_change event. */
  executionMode?: 'manual' | 'auto' | 'sequential' | 'afk';
  /** Board skipped per-task Tester (in_progress may jump to complete after merge). */
  skipPerTaskTesting?: boolean;
  skip?: BoardLogInvariantId[];
}

export interface BoardLogViolation {
  id: BoardLogInvariantId;
  message: string;
  eventId?: string;
  taskId?: string;
}

export interface BoardLogIncompleteEvidence {
  id: BoardLogInvariantId;
  reason: string;
  taskId?: string;
  eventId?: string;
}

export interface BoardLogSkippedCheck {
  id: BoardLogInvariantId;
  reason: string;
}

export interface BoardLogReconstructedState {
  taskStatuses: Record<string, BoardTaskStatus>;
  activePhaseIds: string[];
  activeSlotIds: string[];
  activeHoldIds: string[];
  lifecycleOwners: Record<string, string>;
  boardTerminal?: 'passed' | 'blocked' | 'stopped' | 'failed';
  plannerReportIds: string[];
  completionNotificationIds: string[];
  interactionRequired: boolean;
}

export interface BoardLogMetrics {
  eventCount: number;
  durationMs: number;
  phaseStarts: number;
  phaseEnds: number;
  slotAcquires: number;
  slotReleases: number;
  holdAcquires: number;
  holdReleases: number;
  holdExpiries: number;
  concurrencyObservations: number;
  peakActiveSlots: number;
  peakActiveHolds: number;
  peakActiveTotal: number;
  configuredConcurrencyCap?: number;
  boardTerminalEvents: number;
  plannerReports: number;
  completionNotifications: number;
  interactionsRequired: number;
}

export interface BoardLogCheckResult {
  /** Backward-compatible pass bit; incomplete evidence only affects it in strictEvidence mode. */
  ok: boolean;
  status: 'pass' | 'fail' | 'incomplete';
  complete: boolean;
  violations: BoardLogViolation[];
  incompleteEvidence: BoardLogIncompleteEvidence[];
  skippedChecks: BoardLogSkippedCheck[];
  reconstructed: BoardLogReconstructedState;
  metrics: BoardLogMetrics;
  /** Legacy numeric counters retained for existing CLI/API callers. */
  stats: Record<string, number>;
}

type AttemptKind = 'build' | 'test' | 'fixer' | 'nudge';

interface TaskTimeline {
  status: BoardTaskStatus;
  started: boolean;
  mergeResults: BoardLogEvent[];
  maxAttempt: Partial<Record<AttemptKind, number>>;
  quarantined: boolean;
  quarantineCause?: 'root' | 'dependency';
}

interface CheckContext {
  sorted: BoardLogEvent[];
  tasksById: Map<string, { wave?: string; dependsOn: string[] }>;
  waveOrder: string[];
  caps: { build: number; test: number; fixer: number; nudge: number };
  timelines: Map<string, TaskTimeline>;
  stats: Record<string, number>;
  skipPerTaskTesting: boolean;
}

function parseEventSeq(id: string): number {
  const dash = id.lastIndexOf('-');
  if (dash < 0) return 0;
  const n = Number(id.slice(dash + 1));
  return Number.isFinite(n) ? n : 0;
}

/** Stable ordering: timestamp first, then `${ts}-${seq}` suffix. */
export function sortBoardLogEvents(events: readonly BoardLogEvent[]): BoardLogEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return parseEventSeq(a.id) - parseEventSeq(b.id);
  });
}

function isSkipped(ctx: CheckContext, id: BoardLogInvariantId, skip?: BoardLogInvariantId[]): boolean {
  return skip?.includes(id) === true;
}

function isLegalStatusEdge(
  from: BoardTaskStatus | undefined,
  to: BoardTaskStatus,
  skipPerTaskTesting: boolean,
): boolean {
  if (!from) return to === 'planned' || to === 'in_progress';
  if (to === 'failed' || to === 'blocked') return true;
  if (to === 'planned' && REOPEN_FROM.has(from)) return true;
  if (to === 'quarantined') return true;
  // Clean/skipped merges complete in-process without a visible merging phase.
  if (from === 'testing' && to === 'complete') return true;
  if (skipPerTaskTesting && from === 'in_progress' && to === 'complete') return true;
  // Test failure reopens the Builder without going through merging.
  if (from === 'testing' && to === 'in_progress') return true;
  return FORWARD_CHAIN[from] === to;
}

function ensureTimeline(ctx: CheckContext, taskId: string): TaskTimeline {
  let row = ctx.timelines.get(taskId);
  if (!row) {
    row = {
      status: 'planned',
      started: false,
      mergeResults: [],
      maxAttempt: {},
      quarantined: false,
    };
    ctx.timelines.set(taskId, row);
  }
  return row;
}

function buildWaveOrder(
  tasks: BoardLogCheckOptions['tasks'],
  waveOrder?: string[],
): string[] {
  if (waveOrder?.length) return [...waveOrder];
  const seen: string[] = [];
  const seenSet = new Set<string>();
  for (const task of tasks) {
    const wave = task.wave?.trim();
    if (!wave || seenSet.has(wave)) continue;
    seenSet.add(wave);
    seen.push(wave);
  }
  return seen;
}

function buildDependents(
  tasks: BoardLogCheckOptions['tasks'],
): Map<string, string[]> {
  const taskIds = new Set(tasks.map((t) => t.id));
  const reverse = new Map<string, string[]>();
  for (const task of tasks) {
    for (const depId of task.dependsOn ?? []) {
      if (!taskIds.has(depId)) continue;
      const list = reverse.get(depId) ?? [];
      list.push(task.id);
      reverse.set(depId, list);
    }
  }
  return reverse;
}

function initContext(events: readonly BoardLogEvent[], opts: BoardLogCheckOptions): CheckContext {
  const caps = {
    build: opts.caps?.build ?? DEFAULT_CAPS.build,
    test: opts.caps?.test ?? DEFAULT_CAPS.test,
    fixer: opts.caps?.fixer ?? DEFAULT_CAPS.fixer,
    nudge: opts.caps?.nudge ?? DEFAULT_CAPS.nudge,
  };
  const sorted = sortBoardLogEvents(events);
  const tasksById = new Map(
    opts.tasks.map((t) => [t.id, { wave: t.wave, dependsOn: t.dependsOn ?? [] }]),
  );
  const timelines = new Map<string, TaskTimeline>();
  for (const task of opts.tasks) {
    timelines.set(task.id, {
      status: 'planned',
      started: false,
      mergeResults: [],
      maxAttempt: {},
      quarantined: false,
    });
  }
  return {
    sorted,
    tasksById,
    waveOrder: buildWaveOrder(opts.tasks, opts.waveOrder),
    caps,
    timelines,
    stats: {
      events: sorted.length,
      task_started: 0,
      task_status: 0,
      task_quarantined: 0,
      merge_result: 0,
      final_test_started: 0,
      final_test_verdict: 0,
    },
    skipPerTaskTesting: opts.skipPerTaskTesting === true,
  };
}

function applyEvent(ctx: CheckContext, event: BoardLogEvent): void {
  const type = event.type;
  if (type in ctx.stats) ctx.stats[type] += 1;

  if (type === 'task_started' && event.taskId) {
    ensureTimeline(ctx, event.taskId).started = true;
    return;
  }

  if (type === 'task_status' && event.taskId && event.detail?.to) {
    const row = ensureTimeline(ctx, event.taskId);
    row.status = event.detail.to;
    return;
  }

  if (type === 'task_quarantined' && event.taskId) {
    const row = ensureTimeline(ctx, event.taskId);
    row.status = 'quarantined';
    row.quarantined = true;
    row.quarantineCause = event.detail?.cause;
    return;
  }

  if (type === 'merge_result' && event.taskId) {
    ensureTimeline(ctx, event.taskId).mergeResults.push(event);
    return;
  }

  if ((type === 'task_retry' || type === 'nudge') && event.taskId) {
    const kind = event.detail?.attemptKind;
    const attempt = event.detail?.attempt;
    if (!kind || typeof attempt !== 'number') return;
    const row = ensureTimeline(ctx, event.taskId);
    const prev = row.maxAttempt[kind] ?? 0;
    row.maxAttempt[kind] = Math.max(prev, attempt);
  }
}

function checkStatusTransitions(ctx: CheckContext, violations: BoardLogViolation[]): void {
  for (const event of ctx.sorted) {
    if (event.type === 'task_status') {
      const from = event.detail?.from;
      const to = event.detail?.to;
      if (!to) continue;
      if (!isLegalStatusEdge(from, to, ctx.skipPerTaskTesting)) {
        violations.push({
          id: 'status-transitions',
          message: `illegal task_status edge ${from ?? '?'} → ${to}`,
          eventId: event.id,
          taskId: event.taskId,
        });
      }
      continue;
    }
    if (event.type === 'task_quarantined') {
      const from = event.detail?.from;
      if (from && !isLegalStatusEdge(from, 'quarantined', ctx.skipPerTaskTesting)) {
        violations.push({
          id: 'status-transitions',
          message: `illegal quarantine from ${from}`,
          eventId: event.id,
          taskId: event.taskId,
        });
      }
    }
  }
}

function checkVerdictAfterStart(ctx: CheckContext, violations: BoardLogViolation[]): void {
  const started = new Map<string, boolean>();
  for (const event of ctx.sorted) {
    if (event.type === 'task_started' && event.taskId) {
      started.set(event.taskId, true);
      continue;
    }
    if (
      (event.type === 'build_verdict' ||
        event.type === 'test_verdict' ||
        event.type === 'merge_result') &&
      event.taskId &&
      !started.get(event.taskId)
    ) {
      violations.push({
        id: 'verdict-after-start',
        message: `${event.type} for ${event.taskId} before first task_started`,
        eventId: event.id,
        taskId: event.taskId,
      });
    }
  }
}

function checkAttemptCaps(ctx: CheckContext, violations: BoardLogViolation[]): void {
  for (const [taskId, row] of ctx.timelines) {
    for (const kind of ['build', 'test', 'fixer', 'nudge'] as const) {
      const max = row.maxAttempt[kind];
      if (max === undefined) continue;
      const cap = ctx.caps[kind];
      if (max > cap) {
        violations.push({
          id: 'attempt-caps',
          message: `${taskId}: ${kind} attempt ${max} exceeds cap ${cap}`,
          taskId,
        });
      }
    }
  }
}

function checkMergeIntegrity(ctx: CheckContext, violations: BoardLogViolation[]): void {
  let finalTestStarted = false;
  for (const event of ctx.sorted) {
    if (event.type === 'final_test_started') {
      finalTestStarted = true;
      continue;
    }
    if (event.type !== 'merge_result') continue;

    if (finalTestStarted) {
      violations.push({
        id: 'merge-integrity',
        message: 'merge_result after final_test_started',
        eventId: event.id,
        taskId: event.taskId,
      });
    }

    const outcome = event.detail?.outcome;
    if (outcome && outcome !== 'merged' && outcome !== 'skipped') {
      violations.push({
        id: 'merge-integrity',
        message: `merge_result outcome must be merged or skipped, got ${outcome}`,
        eventId: event.id,
        taskId: event.taskId,
      });
    }
  }

  for (const [taskId, row] of ctx.timelines) {
    if (row.status !== 'complete') continue;
    if (row.mergeResults.length !== 1) {
      violations.push({
        id: 'merge-integrity',
        message: `completed task ${taskId} has ${row.mergeResults.length} merge_result event(s), expected 1`,
        taskId,
      });
    }
  }
}

function isTaskTerminal(status: BoardTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function checkFinalTestOrder(ctx: CheckContext, violations: BoardLogViolation[]): void {
  let startedAt: BoardLogEvent | undefined;
  const liveStatus = new Map<string, BoardTaskStatus>();
  for (const taskId of ctx.tasksById.keys()) {
    liveStatus.set(taskId, 'planned');
  }

  const allTerminalNow = (): boolean => {
    if (ctx.tasksById.size === 0) return true;
    for (const taskId of ctx.tasksById.keys()) {
      if (!isTaskTerminal(liveStatus.get(taskId) ?? 'planned')) return false;
    }
    return true;
  };

  for (const event of ctx.sorted) {
    if (event.type === 'task_status' && event.taskId && event.detail?.to) {
      liveStatus.set(event.taskId, event.detail.to);
    }
    if (event.type === 'task_quarantined' && event.taskId) {
      liveStatus.set(event.taskId, 'quarantined');
    }

    if (event.type === 'final_test_started') {
      if (startedAt) {
        violations.push({
          id: 'final-test-order',
          message: 'overlapping final_test_started before prior final_test_verdict',
          eventId: event.id,
        });
      }
      if (!allTerminalNow()) {
        violations.push({
          id: 'final-test-order',
          message: 'final_test_started before all tasks are terminal',
          eventId: event.id,
        });
      }
      startedAt = event;
      continue;
    }

    if (event.type === 'final_test_verdict') {
      if (!startedAt) {
        violations.push({
          id: 'final-test-order',
          message: 'final_test_verdict before final_test_started',
          eventId: event.id,
        });
      }
      startedAt = undefined;
      continue;
    }

    if (
      startedAt &&
      (event.type === 'task_started' ||
        event.type === 'build_verdict' ||
        event.type === 'test_verdict' ||
        event.type === 'merge_result')
    ) {
      violations.push({
        id: 'final-test-order',
        message: `task activity (${event.type}) overlaps final integration test`,
        eventId: event.id,
        taskId: event.taskId,
      });
    }
  }

  if (startedAt) {
    violations.push({
      id: 'final-test-order',
      message: 'final_test_started without matching final_test_verdict',
      eventId: startedAt.id,
    });
  }
}

function waveIndex(waveOrder: string[], wave: string | undefined): number {
  if (!wave) return -1;
  return waveOrder.indexOf(wave);
}

function checkWaveOrder(ctx: CheckContext, violations: BoardLogViolation[]): void {
  if (ctx.tasksById.size === 0 || ctx.waveOrder.length === 0) return;

  const liveStatus = new Map<string, BoardTaskStatus>();
  for (const taskId of ctx.tasksById.keys()) {
    liveStatus.set(taskId, 'planned');
  }

  for (const event of ctx.sorted) {
    if (event.type === 'task_status' && event.taskId && event.detail?.to) {
      liveStatus.set(event.taskId, event.detail.to);
    }
    if (event.type === 'task_quarantined' && event.taskId) {
      liveStatus.set(event.taskId, 'quarantined');
    }

    if (event.type !== 'task_started' || !event.taskId) continue;
    const meta = ctx.tasksById.get(event.taskId);
    if (!meta) continue;
    const waveIdx = waveIndex(ctx.waveOrder, meta.wave);
    if (waveIdx <= 0) continue;

    for (let prior = 0; prior < waveIdx; prior++) {
      const priorWave = ctx.waveOrder[prior]!;
      for (const [taskId, taskMeta] of ctx.tasksById) {
        if (taskMeta.wave !== priorWave) continue;
        const status = liveStatus.get(taskId) ?? 'planned';
        if (!isTaskTerminal(status)) {
          violations.push({
            id: 'wave-order',
            message: `${event.taskId} (wave ${meta.wave}) started before ${taskId} (wave ${priorWave}) is terminal`,
            eventId: event.id,
            taskId: event.taskId,
          });
          break;
        }
      }
    }
  }
}

function checkDependencyOrder(ctx: CheckContext, violations: BoardLogViolation[]): void {
  if (ctx.tasksById.size === 0) return;

  const liveStatus = new Map<string, BoardTaskStatus>();
  for (const taskId of ctx.tasksById.keys()) {
    liveStatus.set(taskId, 'planned');
  }

  for (const event of ctx.sorted) {
    if (event.type === 'task_status' && event.taskId && event.detail?.to) {
      liveStatus.set(event.taskId, event.detail.to);
    }
    if (event.type === 'task_quarantined' && event.taskId) {
      liveStatus.set(event.taskId, 'quarantined');
    }

    if (event.type !== 'task_started' || !event.taskId) continue;
    const deps = ctx.tasksById.get(event.taskId)?.dependsOn ?? [];
    for (const depId of deps) {
      const depStatus = liveStatus.get(depId) ?? 'planned';
      if (depStatus !== 'complete') {
        violations.push({
          id: 'dependency-order',
          message: `${event.taskId} started before dependency ${depId} is complete (was ${depStatus})`,
          eventId: event.id,
          taskId: event.taskId,
        });
      }
    }
  }
}

function checkQuarantineCascade(ctx: CheckContext, violations: BoardLogViolation[]): void {
  const dependents = buildDependents([...ctx.tasksById.entries()].map(([id, meta]) => ({
    id,
    dependsOn: meta.dependsOn,
  })));

  const quarantineEvents = ctx.sorted.filter((e) => e.type === 'task_quarantined');
  const quarantinedRoots = quarantineEvents.filter((e) => e.detail?.cause === 'root');

  for (const event of quarantinedRoots) {
    const taskId = event.taskId;
    if (!taskId) continue;
    const row = ctx.timelines.get(taskId);
    if (!row) continue;

    const eventIdx = ctx.sorted.indexOf(event);
    const attemptsBefore = { ...row.maxAttempt };
    for (let i = 0; i < eventIdx; i++) {
      const prior = ctx.sorted[i]!;
      if (prior.type !== 'task_retry' || prior.taskId !== taskId) continue;
      const kind = prior.detail?.attemptKind;
      const attempt = prior.detail?.attempt;
      if (!kind || typeof attempt !== 'number') continue;
      const prev = attemptsBefore[kind] ?? 0;
      attemptsBefore[kind] = Math.max(prev, attempt);
    }
    const cappedBefore = Object.entries(attemptsBefore).some(([kind, max]) => {
      const cap = ctx.caps[kind as AttemptKind];
      return max >= cap;
    });
    if (!cappedBefore) {
      violations.push({
        id: 'quarantine-cascade',
        message: `root quarantine for ${taskId} not preceded by attempts at cap`,
        eventId: event.id,
        taskId,
      });
    }

    for (const dependentId of dependents.get(taskId) ?? []) {
      const depEvent = quarantineEvents.find(
        (e) => e.taskId === dependentId && e.detail?.cause === 'dependency',
      );
      if (!depEvent) {
        violations.push({
          id: 'quarantine-cascade',
          message: `dependent ${dependentId} not quarantined after root ${taskId}`,
          eventId: event.id,
          taskId: dependentId,
        });
      }
    }
  }
}

function checkRequireTerminal(ctx: CheckContext, violations: BoardLogViolation[]): void {
  for (const taskId of ctx.tasksById.keys()) {
    const status = ctx.timelines.get(taskId)?.status ?? 'planned';
    if (!isTaskTerminal(status)) {
      violations.push({
        id: 'status-transitions',
        message: `task ${taskId} not terminal at log end (status ${status})`,
        taskId,
      });
    }
  }
}

function checkExpectFinalTest(ctx: CheckContext, violations: BoardLogViolation[]): void {
  if ((ctx.stats.final_test_started ?? 0) < 1) {
    violations.push({
      id: 'final-test-order',
      message: 'expected final_test_started but none found',
    });
  }
  if ((ctx.stats.final_test_verdict ?? 0) < 1) {
    violations.push({
      id: 'final-test-order',
      message: 'expected final_test_verdict but none found',
    });
  }
}

type DurableAudit = {
  incomplete: BoardLogIncompleteEvidence[];
  skipped: BoardLogSkippedCheck[];
  reconstructed: BoardLogReconstructedState;
  metrics: BoardLogMetrics;
};

function lifecycleKey(event: BoardLogEvent): string | undefined {
  if (!event.taskId || typeof event.detail?.lifecycleRun !== 'number') return undefined;
  return `${event.taskId}:${event.detail.lifecycleRun}`;
}

function auditDurableEvents(
  ctx: CheckContext,
  opts: BoardLogCheckOptions,
  violations: BoardLogViolation[],
): DurableAudit {
  const incomplete: BoardLogIncompleteEvidence[] = [];
  const skipped: BoardLogSkippedCheck[] = [];
  const activePhases = new Map<string, BoardLogEvent>();
  const activeSlots = new Map<string, BoardLogEvent>();
  const activeHolds = new Map<string, BoardLogEvent>();
  const owners = new Map<string, { ownerId: string; event: BoardLogEvent }>();
  const taskStatuses = Object.fromEntries(
    [...ctx.tasksById.keys()].map((taskId) => [taskId, 'planned' as BoardTaskStatus]),
  );
  const plannerReportIds: string[] = [];
  const completionNotificationIds: string[] = [];
  let terminalOutcome: BoardLogReconstructedState['boardTerminal'];
  let afk = opts.executionMode === 'afk';
  let interactionRequired = false;
  const firstTs = ctx.sorted[0]?.ts;
  const lastTs = ctx.sorted[ctx.sorted.length - 1]?.ts;
  const metrics: BoardLogMetrics = {
    eventCount: ctx.sorted.length,
    durationMs: firstTs == null || lastTs == null ? 0 : Math.max(0, lastTs - firstTs),
    phaseStarts: 0,
    phaseEnds: 0,
    slotAcquires: 0,
    slotReleases: 0,
    holdAcquires: 0,
    holdReleases: 0,
    holdExpiries: 0,
    concurrencyObservations: 0,
    peakActiveSlots: 0,
    peakActiveHolds: 0,
    peakActiveTotal: 0,
    boardTerminalEvents: 0,
    plannerReports: 0,
    completionNotifications: 0,
    interactionsRequired: 0,
  };

  const violation = (
    id: BoardLogInvariantId,
    message: string,
    event?: BoardLogEvent,
  ): void => {
    violations.push({ id, message, eventId: event?.id, taskId: event?.taskId });
  };

  for (const event of ctx.sorted) {
    if (event.type === 'mode_change' && event.detail?.mode === 'afk') afk = true;
    if (event.type === 'task_status' && event.taskId && event.detail?.to) {
      taskStatuses[event.taskId] = event.detail.to;
    } else if (event.type === 'task_quarantined' && event.taskId) {
      taskStatuses[event.taskId] = 'quarantined';
    }

    if (event.type === 'phase_start') {
      metrics.phaseStarts += 1;
      const id = event.detail?.phaseId;
      if (!id || !event.detail?.phase) {
        violation('phase-pairing', 'phase_start requires phaseId and phase', event);
      } else if (activePhases.has(id)) {
        violation('phase-pairing', `duplicate active phase ${id}`, event);
      } else {
        activePhases.set(id, event);
      }
    } else if (event.type === 'phase_end') {
      metrics.phaseEnds += 1;
      const id = event.detail?.phaseId;
      const start = id ? activePhases.get(id) : undefined;
      if (!id || !event.detail?.phase) {
        violation('phase-pairing', 'phase_end requires phaseId and phase', event);
      } else if (!start) {
        violation('phase-pairing', `phase_end without matching start for ${id}`, event);
      } else {
        if (
          start.detail?.phase !== event.detail.phase ||
          start.taskId !== event.taskId ||
          start.detail?.lifecycleRun !== event.detail.lifecycleRun
        ) {
          violation('phase-pairing', `phase_end correlation mismatch for ${id}`, event);
        }
        activePhases.delete(id);
      }
    } else if (event.type === 'slot_acquire') {
      metrics.slotAcquires += 1;
      const id = event.detail?.slotId;
      if (!id) violation('slot-balance', 'slot_acquire requires slotId', event);
      else if (activeSlots.has(id)) violation('slot-balance', `slot ${id} acquired twice`, event);
      else activeSlots.set(id, event);
    } else if (event.type === 'slot_release') {
      metrics.slotReleases += 1;
      const id = event.detail?.slotId;
      if (!id) violation('slot-balance', 'slot_release requires slotId', event);
      else if (!activeSlots.delete(id)) {
        violation('slot-balance', `slot ${id} released without acquire`, event);
      }
    } else if (event.type === 'hold_acquire') {
      metrics.holdAcquires += 1;
      const id = event.detail?.holdId;
      if (!id) violation('hold-balance', 'hold_acquire requires holdId', event);
      else if (activeHolds.has(id)) violation('hold-balance', `hold ${id} acquired twice`, event);
      else activeHolds.set(id, event);
    } else if (event.type === 'hold_release' || event.type === 'hold_expiry') {
      if (event.type === 'hold_release') metrics.holdReleases += 1;
      else metrics.holdExpiries += 1;
      const id = event.detail?.holdId;
      if (!id) violation('hold-balance', `${event.type} requires holdId`, event);
      else if (!activeHolds.delete(id)) {
        violation('hold-balance', `hold ${id} closed without acquire`, event);
      }
    } else if (event.type === 'concurrency_observation') {
      metrics.concurrencyObservations += 1;
      const { activeSlots: slots, activeHolds: holds, activeTotal, concurrencyCap } =
        event.detail ?? {};
      if (
        typeof slots !== 'number' ||
        typeof holds !== 'number' ||
        typeof activeTotal !== 'number' ||
        typeof concurrencyCap !== 'number'
      ) {
        violation('concurrency-cap', 'concurrency observation requires all counts and cap', event);
      } else {
        metrics.peakActiveSlots = Math.max(metrics.peakActiveSlots, slots);
        metrics.peakActiveHolds = Math.max(metrics.peakActiveHolds, holds);
        metrics.peakActiveTotal = Math.max(metrics.peakActiveTotal, activeTotal);
        metrics.configuredConcurrencyCap =
          metrics.configuredConcurrencyCap == null
            ? concurrencyCap
            : Math.min(metrics.configuredConcurrencyCap, concurrencyCap);
        if (slots !== activeSlots.size || holds !== activeHolds.size) {
          violation(
            'concurrency-cap',
            `observation ${slots} slots/${holds} holds disagrees with reconstructed ${activeSlots.size}/${activeHolds.size}`,
            event,
          );
        }
        if (activeTotal !== slots + holds) {
          violation('concurrency-cap', `activeTotal ${activeTotal} must equal slots + holds`, event);
        }
        if (activeTotal > concurrencyCap) {
          violation('concurrency-cap', `observed concurrency ${activeTotal} exceeds cap ${concurrencyCap}`, event);
        }
      }
    } else if (event.type === 'lifecycle_owner_set') {
      const key = lifecycleKey(event);
      const ownerId = event.detail?.ownerId;
      if (!key || !ownerId || !event.detail?.ownerKind) {
        violation('lifecycle-owner', 'lifecycle_owner_set requires task, lifecycle, owner, and kind', event);
      } else if (owners.has(key)) {
        violation('lifecycle-owner', `lifecycle ${key} already has an active owner`, event);
      } else {
        owners.set(key, { ownerId, event });
      }
    } else if (event.type === 'lifecycle_owner_clear') {
      const key = lifecycleKey(event);
      const ownerId = event.detail?.ownerId;
      const active = key ? owners.get(key) : undefined;
      if (!key || !ownerId) {
        violation('lifecycle-owner', 'lifecycle_owner_clear requires task, lifecycle, and owner', event);
      } else if (!active) {
        violation('lifecycle-owner', `lifecycle ${key} owner cleared without set`, event);
      } else {
        if (active.ownerId !== ownerId) {
          violation('lifecycle-owner', `lifecycle ${key} cleared by non-owner ${ownerId}`, event);
        }
        owners.delete(key);
      }
    } else if (event.type === 'board_terminal') {
      metrics.boardTerminalEvents += 1;
      if (!event.detail?.terminalOutcome) {
        violation('terminal-effects', 'board_terminal requires terminalOutcome', event);
      } else {
        terminalOutcome = event.detail.terminalOutcome;
      }
      if (metrics.boardTerminalEvents > 1) {
        violation('terminal-effects', 'board_terminal emitted more than once', event);
      }
      if (activePhases.size || activeSlots.size || activeHolds.size || owners.size) {
        violation('terminal-effects', 'board became terminal with active phase, slot, hold, or owner', event);
      }
    } else if (event.type === 'planner_report') {
      metrics.plannerReports += 1;
      if (event.detail?.reportId) plannerReportIds.push(event.detail.reportId);
      else violation('terminal-effects', 'planner_report requires reportId', event);
      if (metrics.plannerReports > 1) {
        violation('terminal-effects', 'planner_report emitted more than once', event);
      }
    } else if (event.type === 'completion_notification') {
      metrics.completionNotifications += 1;
      if (event.detail?.notificationId) {
        completionNotificationIds.push(event.detail.notificationId);
      } else {
        violation('terminal-effects', 'completion_notification requires notificationId', event);
      }
      if (metrics.completionNotifications > 1) {
        violation('terminal-effects', 'completion_notification emitted more than once', event);
      }
    } else if (event.type === 'interaction_required') {
      interactionRequired = true;
      metrics.interactionsRequired += 1;
      if (afk) violation('afk-hands-off', 'AFK run requested user interaction', event);
    }
  }

  const hasActivity = ctx.sorted.some((event) =>
    ['task_started', 'build_verdict', 'test_verdict', 'merge_result'].includes(event.type),
  );
  const evidence = (id: BoardLogInvariantId, count: number, reason: string): void => {
    if (opts.skip?.includes(id)) {
      skipped.push({ id, reason: 'explicitly skipped by caller' });
    } else if (count === 0) {
      if (hasActivity || opts.requireTerminal) incomplete.push({ id, reason });
      else skipped.push({ id, reason: 'not applicable: log contains no task activity' });
    }
  };
  evidence('phase-pairing', metrics.phaseStarts + metrics.phaseEnds, 'no phase boundary events');
  evidence('slot-balance', metrics.slotAcquires + metrics.slotReleases, 'no slot accounting events');
  if (opts.skip?.includes('hold-balance')) {
    skipped.push({ id: 'hold-balance', reason: 'explicitly skipped by caller' });
  } else if (metrics.holdAcquires + metrics.holdReleases + metrics.holdExpiries === 0) {
    skipped.push({ id: 'hold-balance', reason: 'no hold lifecycle was recorded' });
  }
  evidence('concurrency-cap', metrics.concurrencyObservations, 'no concurrency observations');
  const ownerEvents = ctx.sorted.filter(
    (event) => event.type === 'lifecycle_owner_set' || event.type === 'lifecycle_owner_clear',
  ).length;
  evidence('lifecycle-owner', ownerEvents, 'no lifecycle owner events');
  if (!opts.skip?.includes('terminal-effects')) {
    if (opts.requireTerminal && metrics.boardTerminalEvents === 0) {
      incomplete.push({ id: 'terminal-effects', reason: 'terminal audit requested but board_terminal is missing' });
    } else if (!opts.requireTerminal && metrics.boardTerminalEvents === 0) {
      skipped.push({ id: 'terminal-effects', reason: 'board_terminal not required for this partial log' });
    }
  }
  if (opts.skip?.includes('afk-hands-off')) {
    skipped.push({ id: 'afk-hands-off', reason: 'explicitly skipped by caller' });
  } else if (!afk) {
    skipped.push({ id: 'afk-hands-off', reason: 'execution mode is not AFK' });
  } else if (metrics.boardTerminalEvents === 0) {
    incomplete.push({ id: 'afk-hands-off', reason: 'AFK negative-interaction audit has no terminal boundary' });
  }

  if (metrics.boardTerminalEvents === 0) {
    for (const event of activePhases.values()) {
      incomplete.push({ id: 'phase-pairing', reason: `phase ${event.detail?.phaseId} still active`, eventId: event.id, taskId: event.taskId });
    }
    for (const event of activeSlots.values()) {
      incomplete.push({ id: 'slot-balance', reason: `slot ${event.detail?.slotId} still active`, eventId: event.id, taskId: event.taskId });
    }
    for (const event of activeHolds.values()) {
      incomplete.push({ id: 'hold-balance', reason: `hold ${event.detail?.holdId} still active`, eventId: event.id, taskId: event.taskId });
    }
    for (const [key, owner] of owners) {
      incomplete.push({ id: 'lifecycle-owner', reason: `lifecycle ${key} still owned by ${owner.ownerId}`, eventId: owner.event.id, taskId: owner.event.taskId });
    }
  }

  return {
    incomplete,
    skipped,
    reconstructed: {
      taskStatuses,
      activePhaseIds: [...activePhases.keys()],
      activeSlotIds: [...activeSlots.keys()],
      activeHoldIds: [...activeHolds.keys()],
      lifecycleOwners: Object.fromEntries([...owners].map(([key, owner]) => [key, owner.ownerId])),
      ...(terminalOutcome ? { boardTerminal: terminalOutcome } : {}),
      plannerReportIds,
      completionNotificationIds,
      interactionRequired,
    },
    metrics,
  };
}

/**
 * Validate a board diagnostic log against structural invariants.
 * Events are processed in `ts` order, then by the numeric suffix of `id`.
 */
export function checkBoardLog(
  events: readonly BoardLogEvent[],
  opts: BoardLogCheckOptions,
): BoardLogCheckResult {
  const ctx = initContext(events, opts);
  const violations: BoardLogViolation[] = [];
  const skip = opts.skip;

  for (const event of ctx.sorted) {
    applyEvent(ctx, event);
  }

  if (!isSkipped(ctx, 'status-transitions', skip)) checkStatusTransitions(ctx, violations);
  if (!isSkipped(ctx, 'verdict-after-start', skip)) checkVerdictAfterStart(ctx, violations);
  if (!isSkipped(ctx, 'attempt-caps', skip)) checkAttemptCaps(ctx, violations);
  if (!isSkipped(ctx, 'merge-integrity', skip)) checkMergeIntegrity(ctx, violations);
  if (!isSkipped(ctx, 'final-test-order', skip)) checkFinalTestOrder(ctx, violations);
  if (!isSkipped(ctx, 'wave-order', skip)) checkWaveOrder(ctx, violations);
  if (!isSkipped(ctx, 'dependency-order', skip)) checkDependencyOrder(ctx, violations);
  if (!isSkipped(ctx, 'quarantine-cascade', skip)) checkQuarantineCascade(ctx, violations);

  if (opts.requireTerminal) checkRequireTerminal(ctx, violations);
  if (opts.expectFinalTest) checkExpectFinalTest(ctx, violations);

  const durable = auditDurableEvents(ctx, opts, violations);
  if (skip?.length) {
    for (let i = violations.length - 1; i >= 0; i -= 1) {
      if (skip.includes(violations[i]!.id)) violations.splice(i, 1);
    }
  }
  ctx.stats.violations = violations.length;
  ctx.stats.incomplete = durable.incomplete.length;
  const complete = durable.incomplete.length === 0;
  const ok = violations.length === 0 && (!opts.strictEvidence || complete);
  return {
    ok,
    status: violations.length ? 'fail' : complete ? 'pass' : 'incomplete',
    complete,
    violations,
    incompleteEvidence: durable.incomplete,
    skippedChecks: durable.skipped,
    reconstructed: durable.reconstructed,
    metrics: durable.metrics,
    stats: ctx.stats,
  };
}
