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
// Plan graph — populated by P0-F
// ---------------------------------------------------------------------------

/** One task as declared in a plan document. Refined in P0-F. */
export interface PlanTask {
  id: string;
  title: string;
  wave: number;
  dependsOn: string[];
  touches: string[];
}

/** A parsed, validated, acyclic plan. Refined in P0-F. */
export interface TaskGraph {
  name: string;
  tasks: PlanTask[];
}

/** A loud, locatable parse failure. Refined in P0-F. */
export interface ParseError {
  line: number;
  column: number;
  message: string;
  hint: string;
}

// ---------------------------------------------------------------------------
// Board state — populated by P0-C
// ---------------------------------------------------------------------------

/** One recorded attempt at a task. Refined in P0-C. */
export interface Attempt {
  attemptId: string;
  role: Role;
}

/**
 * Per-task derived state.
 *
 * There is deliberately **no attempt-count field.** Counts are derived by
 * filtering the journal; a counter would be a second source of truth. Refined in P0-C.
 */
export interface TaskState {
  id: string;
  phase: TaskPhase;
  attempts: Attempt[];
}

/** The whole board, derived. Refined in P0-C. */
export interface BoardState {
  boardId: string;
  status: BoardStatus;
  concurrency: number;
  tasks: Map<string, TaskState>;
}

// ---------------------------------------------------------------------------
// Scheduler — populated by P0-D
// ---------------------------------------------------------------------------

/** One attempt the scheduler wants running right now. Refined in P0-D. */
export interface Desired {
  taskId: string;
  role: Role;
  seedKind: SeedKind;
}

// ---------------------------------------------------------------------------
// Policy — populated by P0-E
// ---------------------------------------------------------------------------

/** What the policy table says happens next. Refined in P0-E. */
export type Action =
  | { kind: 'retry' }
  | { kind: 'abandon'; reason: string }
  | { kind: 'advance' };

// ---------------------------------------------------------------------------
// Snapshot — populated by P0-G
// ---------------------------------------------------------------------------

/** A memoisation cache for the fold. Never a source of truth. Refined in P0-G. */
export interface Snapshot {
  v: number;
  boardId: string;
  throughSeq: number;
  stateHash: string;
  state: unknown;
}
