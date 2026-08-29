/**
 * Shared shapes for the Orchestrator V2 pure core.
 *
 * This file is the single home for the core's type vocabulary. Each module's
 * `.d.ts` companion imports from here rather than redeclaring, so there is one
 * definition of `BoardState` and one of `JournalEvent`.
 *
 * P0-A declares the skeleton; P0-B–P0-F fill in the members.
 */

// ---------------------------------------------------------------------------
// Roles, outcomes, seeds
// ---------------------------------------------------------------------------

/** Who is attempting the work. `merge` and `final` are engine-driven, not agents. */
export type Role = 'builder' | 'tester' | 'merge' | 'final';

/** The subset of roles an LLM agent actually performs. */
export type AgentRole = 'builder' | 'tester';

/**
 * How an attempt ended. The six-way union.
 *
 * `pass` / `fail` / `blocked` are reported *by the agent* through its report tool.
 * `no_report` / `crashed` / `timeout` are produced *by the runner* when the agent
 * did not report one of the first three.
 */
export type AttemptResult =
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'no_report'
  | 'crashed'
  | 'timeout';

/** Which prompt shape a retry gets. P2-E turns these into actual prompts. */
export type SeedKind =
  | 'initial'
  | 'failure-aware'
  | 'repair'
  | 'continue'
  | 'fix'
  | 'rebase';

/** Derived task phase. Never stored — always computed by `derive()`. */
export type TaskPhase =
  | 'idle'
  | 'building'
  | 'testing'
  | 'merging'
  | 'merged'
  | 'abandoned'
  | 'skipped';

/** Board run status. */
export type BoardStatus = 'created' | 'running' | 'stopped';

/** Why a board stopped. */
export type StopReason = 'user' | 'complete' | 'terminal';

// ---------------------------------------------------------------------------
// Journal events — P0-B
// ---------------------------------------------------------------------------

/** The thirteen types the fold understands. Anything else is opaque, not invalid. */
export type KnownEventType =
  | 'board.created'
  | 'board.started'
  | 'board.stopped'
  | 'task.attempt.started'
  | 'task.attempt.ended'
  | 'merge.enqueued'
  | 'merge.succeeded'
  | 'merge.conflicted'
  | 'task.abandoned'
  | 'task.skipped'
  | 'touches.overflow'
  | 'final.test.ended'
  | 'run.finished';

/** Discriminant of a journal event. Widened, because unknown types are tolerated. */
export type JournalEventType = KnownEventType | (string & {});

/**
 * The envelope every persisted event carries.
 *
 * `seq` is a per-board monotonic integer assigned by the journal writer.
 * `ts` is wall-clock and **display-only** — no derivation may read it, or replay
 * stops being deterministic.
 *
 * `seq` and `ts` are optional in flight: the writer stamps them immediately
 * before the append, and the same validator runs on both sides of that.
 */
export interface EventEnvelope {
  v: number;
  seq?: number;
  ts?: number;
  type: JournalEventType;
}

/** One wave as declared in a plan. */
export interface WaveRef {
  n: number;
  name: string;
}

/** Free-form supporting detail. Never read by the fold; carried for the report. */
export type Evidence = Record<string, unknown>;

export type BoardCreatedEvent = EventEnvelope & {
  type: 'board.created';
  boardId: string;
  planPath: string;
  tasks: PlanTask[];
  waves: WaveRef[];
  name?: string;
};
export type BoardStartedEvent = EventEnvelope & { type: 'board.started'; concurrency: number };
export type BoardStoppedEvent = EventEnvelope & { type: 'board.stopped'; reason: StopReason };
export type AttemptStartedEvent = EventEnvelope & {
  type: 'task.attempt.started';
  taskId: string;
  attemptId: string;
  role: Role;
  worktree?: string;
  seedKind?: SeedKind;
};
export type AttemptEndedEvent = EventEnvelope & {
  type: 'task.attempt.ended';
  taskId: string;
  attemptId: string;
  role: Role;
  outcome: AttemptResult;
  summary?: string;
  evidence?: Evidence;
};
export type MergeEnqueuedEvent = EventEnvelope & { type: 'merge.enqueued'; taskId: string };
export type MergeSucceededEvent = EventEnvelope & {
  type: 'merge.succeeded';
  taskId: string;
  sha: string;
};
export type MergeConflictedEvent = EventEnvelope & {
  type: 'merge.conflicted';
  taskId: string;
  files: string[];
};
export type TaskAbandonedEvent = EventEnvelope & {
  type: 'task.abandoned';
  taskId: string;
  reason: string;
  evidence?: Evidence;
};
export type TaskSkippedEvent = EventEnvelope & {
  type: 'task.skipped';
  taskId: string;
  blockedBy: string;
};
export type TouchesOverflowEvent = EventEnvelope & {
  type: 'touches.overflow';
  taskId: string;
  attemptId: string;
  declared: string[];
  actual: string[];
};
export type FinalTestEndedEvent = EventEnvelope & {
  type: 'final.test.ended';
  outcome: 'pass' | 'fail';
  runInstructions?: string;
  evidence?: Evidence;
};
export type RunFinishedEvent = EventEnvelope & { type: 'run.finished'; summary: string };

/** An event the fold understands. */
export type KnownEvent =
  | BoardCreatedEvent
  | BoardStartedEvent
  | BoardStoppedEvent
  | AttemptStartedEvent
  | AttemptEndedEvent
  | MergeEnqueuedEvent
  | MergeSucceededEvent
  | MergeConflictedEvent
  | TaskAbandonedEvent
  | TaskSkippedEvent
  | TouchesOverflowEvent
  | FinalTestEndedEvent
  | RunFinishedEvent;

/** Anything else on the journal: readable, ignorable, never an error. */
export type OpaqueEvent = EventEnvelope & Record<string, unknown>;

/** A journal event. */
export type JournalEvent = KnownEvent | OpaqueEvent;

/** Result of validating a raw journal line. */
export type ValidationResult =
  | { ok: true; event: Record<string, unknown>; known: boolean }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Plan graph — P0-F
// ---------------------------------------------------------------------------

/**
 * One task as declared in a plan document.
 *
 * `dependsOn` is always present and always resolved: absent and empty
 * `Depends on:` parse identically, retiring the Planner prompt's "never emit an
 * empty list" workaround rather than reproducing it.
 */
export interface PlanTask {
  id: string;
  title: string;
  wave: number;
  dependsOn: string[];
  /** Repo-relative globs this task may write. Required, and never empty. */
  touches: string[];
  build: string;
  test: string;
  accept: string;
  /** Line of the `#### Task` heading, for error reporting and UI links. */
  line: number;
}

/** A parsed, validated, acyclic plan. */
export interface TaskGraph {
  name: string;
  overview: string;
  isProject: boolean;
  title: string;
  waves: WaveRef[];
  tasks: PlanTask[];
}

/**
 * A loud, locatable parse failure.
 *
 * A dropped task must be impossible to miss, so every error carries where it is
 * and what to do about it.
 */
export interface ParseError {
  line: number;
  column: number;
  message: string;
  hint: string;
}

// ---------------------------------------------------------------------------
// Board state — P0-C
// ---------------------------------------------------------------------------

/**
 * One recorded attempt at a task. `ended` false means it is still in flight.
 *
 * Merges are attempts too, of role `merge`, synthesised by the fold from
 * `merge.enqueued` / `merge.succeeded` / `merge.conflicted`. That keeps
 * `attemptCount()` a single filter for every role, so the policy table's
 * `merge | conflicted` row needs no special case.
 */
export interface Attempt {
  attemptId: string;
  role: Role;
  worktree: string | null;
  seedKind: SeedKind | null;
  ended: boolean;
  outcome: PolicyOutcome | null;
  summary: string | null;
  evidence: Evidence | null;
}

/** A Builder diff that reached outside what the task declared. Journaled, not failed. */
export interface TouchesOverflow {
  attemptId: string;
  declared: string[];
  actual: string[];
}

/**
 * Per-task derived state.
 *
 * There is deliberately **no attempt-count field**. Counts come from
 * `attemptCount(state, taskId, role)`, which filters `attempts`. A counter would
 * be a second source of truth and would desynchronise.
 *
 * `phase` is recomputed from the accumulated record on every fold, never
 * maintained incrementally — so there is no transition table to get wrong.
 */
export interface TaskState {
  id: string;
  title: string;
  wave: number;
  dependsOn: string[];
  touches: string[];
  buildSpec: string | null;
  testSpec: string | null;
  accept: string | null;
  phase: TaskPhase;
  attempts: Attempt[];
  /** Outcome of the most recent finished attempt, of any role. */
  outcome: PolicyOutcome | null;
  abandonedReason: string | null;
  abandonedEvidence: Evidence | null;
  skippedBy: string | null;
  mergedSha: string | null;
  mergeConflicts: string[] | null;
  touchesOverflow: TouchesOverflow[];
}

/** Result of the end-of-run static (and later browser) verification ladder. */
export interface FinalTestState {
  outcome: 'pass' | 'fail';
  runInstructions: string | null;
  evidence: Evidence | null;
}

/** The whole board, derived. The only state the engine has. */
export interface BoardState {
  boardId: string;
  name: string;
  planPath: string;
  waves: WaveRef[];
  status: BoardStatus;
  concurrency: number;
  /** Insertion-ordered by declared task order, so iteration is deterministic. */
  tasks: Map<string, TaskState>;
  taskOrder: string[];
  /** Enqueued and not yet merged or conflicted, in enqueue order. */
  mergeQueue: string[];
  integrationSha: string | null;
  finalTest: FinalTestState | null;
  finished: boolean;
  stopReason: StopReason | null;
  runSummary: string | null;
}

// ---------------------------------------------------------------------------
// Scheduler — P0-D
// ---------------------------------------------------------------------------

/** One attempt the scheduler wants running right now. */
export interface Desired {
  /** `null` for the board-level Final Tester, which belongs to no task. */
  taskId: string | null;
  role: Role;
  seedKind: SeedKind;
  /** `blocked` repairs in the worktree it broke in rather than a fresh one. */
  sameWorktree: boolean;
}

/**
 * What should happen next to a task with nothing in flight.
 *
 * `start` is for the scheduler; `enqueue` and `abandon` are for the engine to
 * journal. Produced by the single `decide()` call site.
 */
export type NextAction =
  | { kind: 'start'; role: Role; seedKind: SeedKind; sameWorktree: boolean }
  | { kind: 'enqueue' }
  | { kind: 'abandon'; reason: string; evidence: Evidence }
  | { kind: 'none' };

// ---------------------------------------------------------------------------
// Policy — P0-E
// ---------------------------------------------------------------------------

/**
 * What an attempt of any role can end as.
 *
 * `conflicted` is merge-only and is why this is wider than `AttemptResult`.
 */
export type PolicyOutcome = AttemptResult | 'conflicted';

/** Retry always targets the builder — one backward target in the whole table. */
export interface RetryAction {
  kind: 'retry';
  role: 'builder';
  seedKind: SeedKind;
  /** `blocked` repairs in the worktree it broke in. */
  sameWorktree: boolean;
}

/** The one forward edge: builder → tester → merge → done. */
export interface AdvanceAction {
  kind: 'advance';
  to: 'tester' | 'merge' | 'done';
}

/**
 * Every abandonment carries a machine-readable reason and the inputs to the
 * decision, so PRD §11's retroactive measurement stays possible.
 */
export interface AbandonAction {
  kind: 'abandon';
  reason: string;
  evidence: Evidence;
}

/** What the policy table says happens next. */
export type Action = RetryAction | AdvanceAction | AbandonAction;

/** One row of the policy table. */
export interface PolicyRow {
  role: Role | '*';
  outcome: PolicyOutcome | '*';
  /** Applies while `attemptCount < under`. `null` is the unbounded fallback. */
  under: number | null;
  action: RetryAction | AdvanceAction | { kind: 'abandon'; reason: string };
}

// ---------------------------------------------------------------------------
// Snapshot — populated by P0-G
// ---------------------------------------------------------------------------

/**
 * A memoisation cache for the fold. **Never a source of truth.**
 *
 * Deleting every snapshot must change nothing except speed. If a snapshot and
 * the journal disagree, the journal wins and the snapshot is discarded — there
 * is no merge and no repair path, because the moment a snapshot can carry state
 * the journal cannot reproduce, V2 has V1's bug back.
 *
 * `state` is the canonical JSON form, with `Map`s as sorted entry arrays.
 */
export interface Snapshot {
  v: number;
  boardId: string;
  /** The last event folded in. */
  throughSeq: number;
  stateHash: string;
  state: unknown;
}
